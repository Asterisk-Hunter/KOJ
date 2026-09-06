import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  contestProblems,
  contestRegistrations,
  contests,
  problemTestCases,
  problems,
} from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: idRaw } = await ctx.params;
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("invalid problem id", 400);
  }

  const contestIdRaw = req.nextUrl.searchParams.get("contestId");
  let effectiveContestId: number | null = null;
  if (contestIdRaw !== null) {
    const n = Number(contestIdRaw);
    if (Number.isInteger(n) && n > 0) {
      effectiveContestId = n;
    }
    // else treat as not provided (practice mode) — do not 400, per spec
  }

  const rows = await db.select().from(problems).where(eq(problems.id, id)).limit(1);
  if (rows.length === 0) {
    return jsonError("not found", 404);
  }
  const problem = rows[0];

  // Draft never leaks
  if (problem.status === "draft") {
    return jsonError("not found", 404);
  }

  const { userId } = await auth();

  let contestIdToReturn: number | null = null;

  if (problem.status === "published") {
    // Publicly visible. If contestId provided and user signed in, validate and attach.
    if (effectiveContestId !== null && userId) {
      const contestRows = await db
        .select()
        .from(contests)
        .where(eq(contests.id, effectiveContestId))
        .limit(1);
      if (contestRows.length > 0) {
        const contest = contestRows[0];
        if (contest.status === "live") {
          const reg = await db
            .select()
            .from(contestRegistrations)
            .where(
              and(
                eq(contestRegistrations.contestId, effectiveContestId),
                eq(contestRegistrations.userId, userId),
              ),
            )
            .limit(1);
          if (reg.length > 0) {
            const cp = await db
              .select()
              .from(contestProblems)
              .where(
                and(
                  eq(contestProblems.contestId, effectiveContestId),
                  eq(contestProblems.problemId, id),
                ),
              )
              .limit(1);
            if (cp.length > 0) {
              contestIdToReturn = effectiveContestId;
            }
          }
        }
      }
    }
    // published always allowed, no auth required
  } else if (problem.status === "contest_active") {
    // Require signed-in
    if (!userId) {
      return jsonError("unauthorized", 401);
    }

    if (effectiveContestId !== null) {
      // Validate specific contest
      const contestRows = await db
        .select()
        .from(contests)
        .where(eq(contests.id, effectiveContestId))
        .limit(1);
      if (contestRows.length === 0 || contestRows[0].status !== "live") {
        return jsonError("contest not live or not found", 403);
      }
      const reg = await db
        .select()
        .from(contestRegistrations)
        .where(
          and(
            eq(contestRegistrations.contestId, effectiveContestId),
            eq(contestRegistrations.userId, userId),
          ),
        )
        .limit(1);
      if (reg.length === 0) {
        return jsonError("not registered for contest", 403);
      }
      const cp = await db
        .select()
        .from(contestProblems)
        .where(
          and(
            eq(contestProblems.contestId, effectiveContestId),
            eq(contestProblems.problemId, id),
          ),
        )
        .limit(1);
      if (cp.length === 0) {
        return jsonError("problem not in contest", 403);
      }
      contestIdToReturn = effectiveContestId;
    } else {
      // Find any live contest containing this problem where user is registered
      const liveContests = await db
        .select({ contestId: contestProblems.contestId })
        .from(contestProblems)
        .where(eq(contestProblems.problemId, id));

      let found: number | null = null;
      for (const { contestId: cid } of liveContests) {
        const contestRows = await db.select().from(contests).where(eq(contests.id, cid)).limit(1);
        if (contestRows.length === 0 || contestRows[0].status !== "live") continue;
        const reg = await db
          .select()
          .from(contestRegistrations)
          .where(and(eq(contestRegistrations.contestId, cid), eq(contestRegistrations.userId, userId)))
          .limit(1);
        if (reg.length > 0) {
          found = cid;
          break;
        }
      }
      if (found === null) {
        return jsonError("not registered for a live contest containing this problem", 403);
      }
      contestIdToReturn = found;
    }
  }

  // Load samples only
  const sampleRows = await db
    .select()
    .from(problemTestCases)
    .where(and(eq(problemTestCases.problemId, id), eq(problemTestCases.isSample, true)))
    .orderBy(asc(problemTestCases.position));

  const response: Record<string, unknown> = {
    id: problem.id,
    title: problem.title,
    statement: problem.statement,
    inputFormat: problem.inputFormat,
    outputFormat: problem.outputFormat,
    constraints: problem.constraints,
    explanation: problem.explanation,
    difficulty: problem.difficulty,
    tags: problem.tags,
    timeLimitMs: problem.timeLimitMs,
    memoryMb: problem.memoryLimitMb,
    status: problem.status,
    samples: sampleRows.map((r) => ({ input: r.input, expectedOutput: r.expectedOutput })),
  };
  if (contestIdToReturn !== null) {
    response.contestId = contestIdToReturn;
  }

  return NextResponse.json(response);
}
