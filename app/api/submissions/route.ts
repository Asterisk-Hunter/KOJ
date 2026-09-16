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
import { settleExpiredContests } from "@/app/api/contests/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  // Validate language (SRS REQ-JUDGE-02 v1 set)
  const SUPPORTED_LANGUAGES = ["python", "c", "c++", "java"] as const;
  if (
    typeof language !== "string" ||
    !(SUPPORTED_LANGUAGES as readonly string[]).includes(language)
  ) {
    return jsonError("supported languages: python, c, c++, java", 400);
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

  // Settle past-due live contests before enforcing contest windows.
  await settleExpiredContests();

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

  // Rate limit: max 1 submission per 30s per user+problem (REQ-RATE-01/02).
  // Applies to both run and submit modes — both consume judge capacity.
  const recentRows = await db
    .select({ submittedAt: submissions.submittedAt })
    .from(submissions)
    .where(and(eq(submissions.userId, userId), eq(submissions.problemId, problemId)))
    .orderBy(desc(submissions.submittedAt))
    .limit(1);
  if (recentRows.length > 0 && recentRows[0].submittedAt) {
    const elapsedSec = (Date.now() - recentRows[0].submittedAt.getTime()) / 1000;
    if (elapsedSec < 30) {
      const retryAfter = Math.max(1, Math.ceil(30 - elapsedSec));
      return NextResponse.json(
        { error: "rate limited: 1 submission per 30 seconds per problem" },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
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

  // Suspended users cannot submit (run or submit mode).
  const suspensionRows = await db
    .select({ suspended: users.suspended })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);
  if (suspensionRows.length > 0 && suspensionRows[0].suspended) {
    return jsonError("account suspended", 403);
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

  // Fire-and-forget async judge via Cloud Run
  const fastApiUrl = process.env.FASTAPI_URL ?? "http://127.0.0.1:8000";
  const judgeSecret = process.env.JUDGE_INTERNAL_SECRET ?? "";

  try {
    await fetch(`${fastApiUrl.replace(/\/$/, "")}/judge-async`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Judge-Secret": judgeSecret,
      },
      body: JSON.stringify({ submission_id: submissionId }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
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

  return NextResponse.json(
    { id: submissionId, status: "running" },
    { status: 202 },
  );
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
