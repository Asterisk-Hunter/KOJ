import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  contestProblems,
  contestRegistrations,
  contests,
  problemTestCases,
  problems,
  submissions,
  users,
} from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SubmitMode = "run" | "submit";

interface PostBody {
  problemId: number;
  contestId?: number | null;
  language: string;
  code: string;
  mode: SubmitMode;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return jsonError("unauthorized", 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid json", 400);
  }

  const b = body as Partial<PostBody>;

  const problemId = b.problemId;
  const contestId = b.contestId ?? null;
  const language = b.language;
  const code = b.code;
  const mode = b.mode;

  // Validate problemId
  if (typeof problemId !== "number" || !Number.isInteger(problemId) || problemId <= 0) {
    return jsonError("problemId must be a positive integer", 400);
  }
  // Validate contestId
  if (contestId !== null && contestId !== undefined) {
    if (typeof contestId !== "number" || !Number.isInteger(contestId) || contestId <= 0) {
      return jsonError("contestId must be a positive integer or null", 400);
    }
  }
  // Validate language
  if (typeof language !== "string" || language !== "python") {
    return jsonError("only python is supported", 400);
  }
  // Validate code
  if (typeof code !== "string" || code.trim().length === 0) {
    return jsonError("code must be non-empty", 400);
  }
  // 100KB limit — use byte length
  const codeBytes = Buffer.byteLength(code, "utf8");
  if (codeBytes > 100 * 1024) {
    return jsonError("code exceeds 100KB limit", 400);
  }
  // Validate mode
  if (mode !== "run" && mode !== "submit") {
    return jsonError("mode must be 'run' or 'submit'", 400);
  }

  const effectiveContestId: number | null = contestId ?? null;

  // Load problem
  const problemRows = await db
    .select()
    .from(problems)
    .where(eq(problems.id, problemId))
    .limit(1);
  if (problemRows.length === 0) {
    return jsonError("problem not found", 404);
  }
  const problem = problemRows[0];

  // Contest vs practice validation
  if (effectiveContestId !== null) {
    const contestRows = await db
      .select()
      .from(contests)
      .where(eq(contests.id, effectiveContestId))
      .limit(1);
    if (contestRows.length === 0) {
      return jsonError("contest not found", 403);
    }
    const contest = contestRows[0];
    if (contest.status !== "live") {
      return jsonError("contest is not live", 403);
    }
    const regRows = await db
      .select()
      .from(contestRegistrations)
      .where(
        and(
          eq(contestRegistrations.contestId, effectiveContestId),
          eq(contestRegistrations.userId, userId),
        ),
      )
      .limit(1);
    if (regRows.length === 0) {
      return jsonError("not registered for contest", 403);
    }
    const cpRows = await db
      .select()
      .from(contestProblems)
      .where(
        and(
          eq(contestProblems.contestId, effectiveContestId),
          eq(contestProblems.problemId, problemId),
        ),
      )
      .limit(1);
    if (cpRows.length === 0) {
      return jsonError("problem not in contest", 400);
    }
  } else {
    if (problem.status !== "published") {
      return jsonError("problem not available for practice", 403);
    }
  }

  // Ensure users row
  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);
  if (existingUser.length === 0) {
    try {
      const client = await clerkClient();
      const clerkUser = await client.users.getUser(userId);
      const primaryEmail =
        clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)
          ?.emailAddress ??
        clerkUser.emailAddresses[0]?.emailAddress ??
        "";
      const username =
        clerkUser.username ??
        clerkUser.firstName ??
        (primaryEmail ? primaryEmail.split("@")[0] : userId);
      const email = primaryEmail || `${userId}@placeholder.local`;
      if (!username || !email) {
        return jsonError("failed to resolve user", 500);
      }
      await db.insert(users).values({
        clerkId: userId,
        username,
        email,
      });
    } catch {
      return jsonError("failed to resolve user", 500);
    }
  }

  // Load cases ordered by position
  let caseRows: (typeof problemTestCases.$inferSelect)[];
  if (mode === "run") {
    caseRows = await db
      .select()
      .from(problemTestCases)
      .where(and(eq(problemTestCases.problemId, problemId), eq(problemTestCases.isSample, true)))
      .orderBy(asc(problemTestCases.position));
    if (caseRows.length === 0) {
      return jsonError("no sample cases", 400);
    }
  } else {
    caseRows = await db
      .select()
      .from(problemTestCases)
      .where(eq(problemTestCases.problemId, problemId))
      .orderBy(asc(problemTestCases.position));
    if (caseRows.length === 0) {
      return jsonError("no test cases", 400);
    }
  }

  // Insert submission pending
  const inserted = await db
    .insert(submissions)
    .values({
      userId,
      problemId,
      contestId: effectiveContestId,
      language,
      code,
      status: "pending",
    })
    .returning({ id: submissions.id });

  const submissionId = inserted[0].id;

  await db
    .update(submissions)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(submissions.id, submissionId));

  // Call FastAPI /judge — fallback is dev-only; prod must set FASTAPI_URL
  const fastApiUrl = process.env.FASTAPI_URL ?? "http://127.0.0.1:8000";
  const judgeSecret = process.env.JUDGE_INTERNAL_SECRET ?? "";
  const judgeUrl = `${fastApiUrl.replace(/\/$/, "")}/judge`;

  const judgeCases = caseRows.map((c) => ({
    stdin: c.input,
    expected_stdout: c.expectedOutput,
  }));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55000);

  let judgeRes: Response;
  try {
    judgeRes = await fetch(judgeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Judge-Secret": judgeSecret,
      },
      body: JSON.stringify({
        language,
        code,
        cases: judgeCases,
        time_limit_ms: problem.timeLimitMs,
        memory_mb: problem.memoryLimitMb,
      }),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeoutId);
    await db
      .update(submissions)
      .set({
        status: "runtime_error",
        errorMessage: "judge unavailable",
        completedAt: new Date(),
      })
      .where(eq(submissions.id, submissionId));
    return jsonError("judge unavailable", 502);
  }
  clearTimeout(timeoutId);

  if (!judgeRes.ok) {
    // Map judge errors to runtime_error in DB except 422/401
    const text = await judgeRes.text().catch(() => "");
    await db
      .update(submissions)
      .set({
        status: "runtime_error",
        errorMessage: text.slice(0, 2048) || "judge unavailable",
        completedAt: new Date(),
      })
      .where(eq(submissions.id, submissionId));
    // If judge returned 401/422 etc, propagate as 502 per spec (judge unavailable)
    return jsonError("judge unavailable", 502);
  }

  type JudgeResponse = {
    status: string;
    passed_tests: number;
    total_tests: number;
    execution_time_ms: number;
    error_message: string | null;
    cases: unknown;
  };

  const data = (await judgeRes.json()) as JudgeResponse;

  // Validate judge response shape minimally
  const status = data.status as typeof submissions.$inferSelect.status;
  const passedTests = typeof data.passed_tests === "number" ? data.passed_tests : 0;
  const totalTests = typeof data.total_tests === "number" ? data.total_tests : caseRows.length;
  const executionTimeMs = typeof data.execution_time_ms === "number" ? data.execution_time_ms : 0;
  const errorMessage = data.error_message ?? null;

  await db
    .update(submissions)
    .set({
      status,
      passedTests,
      totalTests,
      executionTimeMs,
      errorMessage,
      completedAt: new Date(),
    })
    .where(eq(submissions.id, submissionId));

  return NextResponse.json({
    id: submissionId,
    status,
    passedTests,
    totalTests,
    executionTimeMs,
    errorMessage,
  });
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return jsonError("unauthorized", 401);
  }

  const url = req.nextUrl;
  const problemIdRaw = url.searchParams.get("problemId");
  const contestIdRaw = url.searchParams.get("contestId");

  if (!problemIdRaw) {
    return jsonError("problemId is required", 400);
  }
  const problemId = Number(problemIdRaw);
  if (!Number.isInteger(problemId) || problemId <= 0) {
    return jsonError("problemId must be a positive integer", 400);
  }

  let contestId: number | undefined;
  if (contestIdRaw !== null) {
    const cid = Number(contestIdRaw);
    if (!Number.isInteger(cid) || cid <= 0) {
      return jsonError("contestId must be a positive integer", 400);
    }
    contestId = cid;
  }

  let rows: (typeof submissions.$inferSelect)[];
  if (contestId !== undefined) {
    rows = await db
      .select()
      .from(submissions)
      .where(
        and(
          eq(submissions.userId, userId),
          eq(submissions.problemId, problemId),
          eq(submissions.contestId, contestId as number),
        ),
      )
      .orderBy(desc(submissions.submittedAt));
  } else {
    rows = await db
      .select()
      .from(submissions)
      .where(and(eq(submissions.userId, userId), eq(submissions.problemId, problemId)))
      .orderBy(desc(submissions.submittedAt));
  }

  const result = rows.map((r) => ({
    id: r.id,
    status: r.status,
    passedTests: r.passedTests,
    totalTests: r.totalTests,
    executionTimeMs: r.executionTimeMs,
    submittedAt: r.submittedAt?.toISOString() ?? null,
  }));

  return NextResponse.json(result);
}
