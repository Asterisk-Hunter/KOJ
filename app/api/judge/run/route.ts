import { withApiGuard } from "@/app/api/guard";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { contestProblems, contestRegistrations, contestVirtualRegistrations, contests, problems } from "@/db/schema";
import { MAX_INTERACTIVE_RUN_BODY_BYTES, readBoundedJsonObject } from "@/app/api/body-guard";
import { parseOutputComparator, parseOutputTolerance } from "@/app/api/admin/problems/comparator";
import { resolveOrganizationContext } from "@/lib/organizations";
import { consumeRateBudget } from "@/app/api/rate-limit";
import { getArenaParticipation } from "@/app/api/contests/participation-policy";

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
  input?: unknown;
  expectedOutput?: unknown;
  cases?: unknown;
  timeLimitMs?: number;
  memoryMb?: number;
  outputComparator?: unknown;
  absoluteTolerance?: unknown;
  relativeTolerance?: unknown;
  problemId?: unknown;
  contestId?: unknown;
}


function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function handlePOST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return jsonError("unauthorized", 401);
  }
  const organization = await resolveOrganizationContext(userId);
  if (!organization) return jsonError("organization not found", 404);
  if (organization.suspended) return jsonError("account suspended", 403);


  const parsed = await readBoundedJsonObject(req, MAX_INTERACTIVE_RUN_BODY_BYTES, "invalid json");
  if (!parsed.ok) return parsed.response;
  const b = parsed.value as Partial<SingleRunBody>;
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

  let outputComparator = parseOutputComparator(b.outputComparator ?? "exact");
  if (!outputComparator) return jsonError("outputComparator must be exact or float", 400);
  let absoluteTolerance = parseOutputTolerance(b.absoluteTolerance ?? 0.000001);
  if (absoluteTolerance === null) return jsonError("absoluteTolerance must be between 0 and 1", 400);
  let relativeTolerance = parseOutputTolerance(b.relativeTolerance ?? 0.000001);
  if (relativeTolerance === null) return jsonError("relativeTolerance must be between 0 and 1", 400);

  let checkerCode: string | null = null;
  let accessWindow: { startsAt: Date; endsAt: Date } | null = null;
  if (b.contestId !== undefined && b.contestId !== null &&
      (typeof b.contestId !== "number" || !Number.isSafeInteger(b.contestId) || b.contestId <= 0)) {
    return jsonError("contestId must be a positive integer or null", 400);
  }
  if (b.contestId !== undefined && b.contestId !== null && b.problemId === undefined) {
    return jsonError("problemId is required with contestId", 400);
  }
  if (b.problemId !== undefined) {
    if (typeof b.problemId !== "number" || !Number.isInteger(b.problemId) || b.problemId <= 0) {
      return jsonError("problemId must be a positive integer", 400);
    }
    const problemRows = await db
      .select({
        status: problems.status,
        outputComparator: problems.outputComparator,
        absoluteTolerance: problems.absoluteTolerance,
        relativeTolerance: problems.relativeTolerance,
        checkerCode: problems.checkerCode,
      })
      .from(problems)
      .where(and(
        eq(problems.id, b.problemId),
        eq(problems.organizationId, organization.organizationId),
      ))
      .limit(1);
    const problem = problemRows[0];
    if (!problem || problem.status === "draft") return jsonError("problem not found", 404);
    if (problem.status === "contest_active" || (b.contestId !== undefined && b.contestId !== null)) {
      if (typeof b.contestId !== "number" || !Number.isInteger(b.contestId) || b.contestId <= 0) {
        return jsonError("contestId is required for contest problems", 400);
      }
      const contestRows = await db
        .select({ status: contests.status, startsAt: contests.startsAt, endsAt: contests.endsAt })
        .from(contests)
        .where(and(
          eq(contests.id, b.contestId),
          eq(contests.organizationId, organization.organizationId),
        ))
        .limit(1);
      const contest = contestRows[0];
      if (!contest) return jsonError("contest is not available", 403);
      const [attempt] = contest.status === "ended" || contest.status === "archived"
        ? await db.select({ startedAt: contestVirtualRegistrations.startedAt, endsAt: contestVirtualRegistrations.endsAt })
          .from(contestVirtualRegistrations).where(and(
            eq(contestVirtualRegistrations.contestId, b.contestId), eq(contestVirtualRegistrations.userId, userId),
          )).limit(1)
        : [];
      const participation = getArenaParticipation(contest, attempt ?? null, new Date());
      if (!participation) return jsonError("contest is not available or virtual participation expired", 403);
      if (participation === "official") {
        const registrations = await db.select({ userId: contestRegistrations.userId }).from(contestRegistrations)
          .where(and(eq(contestRegistrations.contestId, b.contestId), eq(contestRegistrations.userId, userId))).limit(1);
        if (registrations.length === 0) return jsonError("not registered for contest", 403);
        accessWindow = { startsAt: contest.startsAt, endsAt: contest.endsAt };
      } else if (attempt) {
        accessWindow = { startsAt: attempt.startedAt, endsAt: attempt.endsAt };
      }
      const problemLinks = await db
        .select({ problemId: contestProblems.problemId })
        .from(contestProblems)
        .where(
          and(
            eq(contestProblems.contestId, b.contestId),
            eq(contestProblems.problemId, b.problemId),
            eq(contestProblems.organizationId, organization.organizationId),
          ),
        )
        .limit(1);
      if (problemLinks.length === 0) return jsonError("problem not in contest", 403);
    }
    outputComparator = problem.outputComparator as "exact" | "float";
    absoluteTolerance = problem.absoluteTolerance;
    relativeTolerance = problem.relativeTolerance;
    checkerCode = problem.checkerCode;
  }

  if (Buffer.byteLength(code, "utf8") > 100 * 1024) {
    return jsonError("code exceeds 100KB limit", 400);
  }

  const timeLimitMs = Math.min(
    10000,
    Math.max(100, typeof b.timeLimitMs === "number" && Number.isInteger(b.timeLimitMs) ? b.timeLimitMs : 2000),
  );
  const memoryMb = Math.min(
    1024,
    Math.max(16, typeof b.memoryMb === "number" && Number.isInteger(b.memoryMb) ? b.memoryMb : 256),
  );

  // Every case on this endpoint is interactive: it is either a sample the problem
  // already shows publicly or a stdin the caller typed themselves. None of it is
  // hidden-test content, so it is always flagged as a sample — otherwise the judge
  // redacts stdout and the runner shows "(no stdout)" beside a passing verdict.
  let judgeCases: Array<{ stdin: string; expected_stdout: string; is_sample: boolean }>;
  const isMultiCase = b.cases !== undefined;
  let customExpectedProvided = false;

  if (isMultiCase) {
    if (!Array.isArray(b.cases) || b.cases.length === 0) {
      return jsonError("cases must be a non-empty array", 400);
    }
    // Multi-case run (e.g. running against all sample test cases)
    if (b.cases.length > 10) {
      return jsonError("maximum 10 sample test cases allowed in interactive run", 400);
    }
    judgeCases = [];
    for (let i = 0; i < b.cases.length; i++) {
      const c: unknown = b.cases[i];
      if (!c || typeof c !== "object" || Array.isArray(c) ||
          !("stdin" in c) || typeof c.stdin !== "string" ||
          !("expectedOutput" in c) || typeof c.expectedOutput !== "string") {
        return jsonError(`test case #${i + 1} must have string stdin and expectedOutput`, 400);
      }
      if (Buffer.byteLength(c.stdin, "utf8") > 64 * 1024) {
        return jsonError(`test case #${i + 1} stdin exceeds 64KB limit`, 400);
      }
      if (Buffer.byteLength(c.expectedOutput, "utf8") > 64 * 1024) {
        return jsonError(`test case #${i + 1} expected output exceeds 64KB limit`, 400);
      }
      judgeCases.push({ stdin: c.stdin, expected_stdout: c.expectedOutput, is_sample: true });
    }
  } else {
    // Single custom test run
    if ((b.input !== undefined && typeof b.input !== "string") ||
        (b.expectedOutput !== undefined && typeof b.expectedOutput !== "string")) {
      return jsonError("input and expectedOutput must be strings", 400);
    }
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

  const budget = await consumeRateBudget({ scope: "interactive-cooldown", identity: userId, limit: 1, windowSeconds: 2.5 });
  if (!budget.allowed) {
    return NextResponse.json({ error: `Please wait ${budget.retryAfter}s before running again.` },
      { status: 429, headers: { "Retry-After": String(budget.retryAfter) } });
  }
  const dispatchAt = new Date();
  if (accessWindow && (dispatchAt < accessWindow.startsAt || dispatchAt >= accessWindow.endsAt)) {
    return jsonError("contest participation time expired", 403);
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
        output_comparator: outputComparator,
        absolute_tolerance: absoluteTolerance,
        relative_tolerance: relativeTolerance,
        checker_code: checkerCode,
      }),
      signal: AbortSignal.timeout(35000),
    });

    if (!res.ok) {
      return jsonError("judge execution failed", 502);
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
      infra_error?: boolean;
      status: string;
      passed_tests: number;
      total_tests: number;
      execution_time_ms: number;
      memory_used_mb?: number;
      error_message?: string | null;
      cases?: FastApiCaseResult[];
    };

    const judgeData = (await res.json()) as FastApiJudgeResponse;
    if (judgeData.infra_error) return jsonError("judge service temporarily unavailable", 503);

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
  } catch {
    return jsonError("judge service unavailable", 502);
  }
}

export const POST = withApiGuard(handlePOST);
