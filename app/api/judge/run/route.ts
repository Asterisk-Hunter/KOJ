import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPPORTED_LANGUAGES = [
  "python",
  "c",
  "c++",
  "java",
  "go",
  "rust",
  "javascript",
] as const;
type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

interface SingleRunBody {
  language: string;
  code: string;
  input?: string;
  expectedOutput?: string;
  cases?: Array<{ stdin: string; expectedOutput: string }>;
  timeLimitMs?: number;
  memoryMb?: number;
}

// In-memory rate limiting map for interactive testing: user ID -> last run timestamp
const recentRuns = new Map<string, number>();
const INTERACTIVE_RATE_LIMIT_MS = 2500; // 2.5s cooldown between runs

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return jsonError("unauthorized", 401);
  }

  // Security check: Verify account is not suspended
  const suspensionRows = await db
    .select({ suspended: users.suspended })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);
  if (suspensionRows.length > 0 && suspensionRows[0].suspended) {
    return jsonError("account suspended", 403);
  }

  // Rate limiting check
  const now = Date.now();
  const lastRun = recentRuns.get(userId);
  if (lastRun && now - lastRun < INTERACTIVE_RATE_LIMIT_MS) {
    const remainingSec = Math.ceil((INTERACTIVE_RATE_LIMIT_MS - (now - lastRun)) / 1000);
    return NextResponse.json(
      { error: `Please wait ${remainingSec}s before running again.` },
      { status: 429, headers: { "Retry-After": String(remainingSec) } },
    );
  }
  recentRuns.set(userId, now);

  // Clean old entries periodically
  if (recentRuns.size > 2000) {
    const threshold = now - 60000;
    for (const [uid, ts] of recentRuns.entries()) {
      if (ts < threshold) recentRuns.delete(uid);
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid json", 400);
  }

  const b = body as Partial<SingleRunBody>;
  const language = b.language;
  const code = b.code;

  if (
    typeof language !== "string" ||
    !(SUPPORTED_LANGUAGES as readonly string[]).includes(language as SupportedLanguage)
  ) {
    return jsonError(`supported languages: ${SUPPORTED_LANGUAGES.join(", ")}`, 400);
  }

  if (typeof code !== "string" || code.trim().length === 0) {
    return jsonError("code must be non-empty", 400);
  }

  if (Buffer.byteLength(code, "utf8") > 100 * 1024) {
    return jsonError("code exceeds 100KB limit", 400);
  }

  const timeLimitMs = Math.min(
    10000,
    Math.max(100, typeof b.timeLimitMs === "number" && Number.isInteger(b.timeLimitMs) ? b.timeLimitMs : 2000),
  );
  const memoryMb = Math.min(
    2048,
    Math.max(16, typeof b.memoryMb === "number" && Number.isInteger(b.memoryMb) ? b.memoryMb : 256),
  );

  // Every case on this endpoint is interactive: it is either a sample the problem
  // already shows publicly or a stdin the caller typed themselves. None of it is
  // hidden-test content, so it is always flagged as a sample — otherwise the judge
  // redacts stdout and the runner shows "(no stdout)" beside a passing verdict.
  let judgeCases: Array<{ stdin: string; expected_stdout: string; is_sample: boolean }>;
  const isMultiCase = Array.isArray(b.cases) && b.cases.length > 0;
  let customExpectedProvided = false;

  if (isMultiCase && b.cases) {
    // Multi-case run (e.g. running against all sample test cases)
    if (b.cases.length > 10) {
      return jsonError("maximum 10 sample test cases allowed in interactive run", 400);
    }
    for (let i = 0; i < b.cases.length; i++) {
      const c = b.cases[i];
      if (typeof c.stdin === "string" && Buffer.byteLength(c.stdin, "utf8") > 64 * 1024) {
        return jsonError(`test case #${i + 1} stdin exceeds 64KB limit`, 400);
      }
      if (typeof c.expectedOutput === "string" && Buffer.byteLength(c.expectedOutput, "utf8") > 64 * 1024) {
        return jsonError(`test case #${i + 1} expected output exceeds 64KB limit`, 400);
      }
    }
    judgeCases = b.cases.map((c) => ({
      stdin: typeof c.stdin === "string" ? c.stdin : "",
      expected_stdout: typeof c.expectedOutput === "string" ? c.expectedOutput : "",
      is_sample: true,
    }));
  } else {
    // Single custom test run
    const input = typeof b.input === "string" ? b.input : "";
    const expectedOutput = typeof b.expectedOutput === "string" ? b.expectedOutput : "";
    customExpectedProvided = expectedOutput.trim().length > 0;

    if (Buffer.byteLength(input, "utf8") > 64 * 1024) {
      return jsonError("input exceeds 64KB limit", 400);
    }
    if (Buffer.byteLength(expectedOutput, "utf8") > 64 * 1024) {
      return jsonError("expected output exceeds 64KB limit", 400);
    }
    judgeCases = [{ stdin: input, expected_stdout: expectedOutput, is_sample: true }];
  }

  const fastApiUrl =
    process.env.FASTAPI_URL ?? process.env.JUDGE_API_URL ?? "http://127.0.0.1:8000";
  const judgeSecret = process.env.JUDGE_INTERNAL_SECRET ?? "";

  try {
    const res = await fetch(`${fastApiUrl.replace(/\/$/, "")}/judge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Judge-Secret": judgeSecret,
      },
      body: JSON.stringify({
        language,
        code,
        cases: judgeCases,
        time_limit_ms: timeLimitMs,
        memory_mb: memoryMb,
      }),
      signal: AbortSignal.timeout(35000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return jsonError(`Judge error (${res.status}): ${errText.slice(0, 200)}`, 502);
    }

    type FastApiCaseResult = {
      index: number;
      passed: boolean;
      verdict: string;
      runtime_ms: number;
      stdout: string;
      stderr: string;
    };

    type FastApiJudgeResponse = {
      status: string;
      passed_tests: number;
      total_tests: number;
      execution_time_ms: number;
      memory_used_mb?: number;
      error_message?: string | null;
      cases?: FastApiCaseResult[];
    };

    const judgeData = (await res.json()) as FastApiJudgeResponse;

    // If this was a custom single run without an expected output specified,
    // don't treat non-matching output as wrong_answer:
    let effectiveOverallStatus = judgeData.status;
    if (!isMultiCase && !customExpectedProvided) {
      if (judgeData.status === "wrong_answer" || judgeData.status === "presentation_error") {
        effectiveOverallStatus = "finished";
      }
    }

    const formattedCases = (judgeData.cases ?? []).map((c, i) => {
      let passed = c.passed;
      let verdict = c.verdict;
      if (!isMultiCase && !customExpectedProvided) {
        if (verdict === "wrong_answer" || verdict === "presentation_error") {
          verdict = "finished";
          passed = true;
        }
      }
      return {
        index: c.index ?? i,
        passed,
        verdict,
        runtimeMs: c.runtime_ms,
        stdout: c.stdout ?? "",
        stderr: c.stderr ?? "",
        stdin: judgeCases[i]?.stdin ?? "",
        expectedOutput: judgeCases[i]?.expected_stdout ?? "",
      };
    });

    return NextResponse.json({
      status: effectiveOverallStatus,
      passedTests: !isMultiCase && !customExpectedProvided && effectiveOverallStatus === "finished" ? 1 : judgeData.passed_tests,
      totalTests: judgeData.total_tests,
      executionTimeMs: judgeData.execution_time_ms,
      memoryUsedMb: judgeData.memory_used_mb ?? 0,
      errorMessage: judgeData.error_message ?? null,
      cases: formattedCases,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "judge execution failed";
    return jsonError(`Judge service unavailable: ${msg}`, 502);
  }
}
