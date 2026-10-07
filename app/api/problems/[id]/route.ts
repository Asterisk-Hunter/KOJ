import { withApiGuard } from "@/app/api/guard";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { resolveOrganizationContext } from "@/lib/organizations";
import {
  contestProblems,
  contestRegistrations,
  contestVirtualRegistrations,
  contests,
  problemTestCases,
  problems,
} from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function handleGET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: idRaw } = await ctx.params;
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("invalid problem id", 400);
  }

  const { userId } = await auth();
  const organization = await resolveOrganizationContext(userId);
  if (!organization) return jsonError("organization not found", 404);
  if (organization.suspended) return jsonError("account suspended", 403);

  const contestIdRaw = req.nextUrl.searchParams.get("contestId");
  let effectiveContestId: number | null = null;
  if (contestIdRaw !== null) {
    const n = Number(contestIdRaw);
    if (Number.isInteger(n) && n > 0) {
      effectiveContestId = n;
    }
    // else treat as not provided (practice mode) — do not 400, per spec
  }

  const rows = await db.select().from(problems).where(and(
    eq(problems.id, id),
    eq(problems.organizationId, organization.organizationId),
  )).limit(1);
  if (rows.length === 0) {
    return jsonError("not found", 404);
  }
  const problem = rows[0];

  // Draft never leaks
  if (problem.status === "draft") {
    return jsonError("not found", 404);
  }

  let contestIdToReturn: number | null = null;

  if (problem.status === "published") {
    // Publicly visible. If contestId provided and user signed in, validate and attach.
    if (effectiveContestId !== null && userId) {
      const contestRows = await db
        .select()
        .from(contests)
        .where(and(eq(contests.id, effectiveContestId), eq(contests.organizationId, organization.organizationId)))
        .limit(1);
      if (contestRows.length > 0) {
        const contest = contestRows[0];
        if (contest.status === "live" && Date.now() >= contest.startsAt.getTime() && Date.now() < contest.endsAt.getTime()) {
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
                  eq(contestProblems.organizationId, organization.organizationId),
                ),
              )
              .limit(1);
            if (cp.length > 0) {
              contestIdToReturn = effectiveContestId;
            }
          }
        } else if (contest.status === "ended" || contest.status === "archived") {
          const virtualRows = await db.select({ endsAt: contestVirtualRegistrations.endsAt }).from(contestVirtualRegistrations)
            .where(and(eq(contestVirtualRegistrations.contestId, effectiveContestId), eq(contestVirtualRegistrations.userId, userId))).limit(1);
          const cp = await db.select({ problemId: contestProblems.problemId }).from(contestProblems)
            .where(and(
              eq(contestProblems.contestId, effectiveContestId),
              eq(contestProblems.problemId, id),
              eq(contestProblems.organizationId, organization.organizationId),
            )).limit(1);
          if (virtualRows.length > 0 && Date.now() < virtualRows[0].endsAt.getTime() && cp.length > 0) {
            contestIdToReturn = effectiveContestId;
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
        .where(and(eq(contests.id, effectiveContestId), eq(contests.organizationId, organization.organizationId)))
        .limit(1);
      if (contestRows.length === 0) return jsonError("contest not found", 403);
      const targetContest = contestRows[0];
      if (targetContest.status === "live" && Date.now() >= targetContest.startsAt.getTime() && Date.now() < targetContest.endsAt.getTime()) {
        const reg = await db.select({ userId: contestRegistrations.userId }).from(contestRegistrations)
          .where(and(eq(contestRegistrations.contestId, effectiveContestId), eq(contestRegistrations.userId, userId))).limit(1);
        if (reg.length === 0) return jsonError("not registered for contest", 403);
      } else if (targetContest.status === "ended" || targetContest.status === "archived") {
        const virtual = await db.select({ endsAt: contestVirtualRegistrations.endsAt }).from(contestVirtualRegistrations)
          .where(and(eq(contestVirtualRegistrations.contestId, effectiveContestId), eq(contestVirtualRegistrations.userId, userId))).limit(1);
        if (virtual.length === 0 || Date.now() >= virtual[0].endsAt.getTime()) return jsonError("active virtual participation required", 403);
      } else {
        return jsonError("contest not accepting submissions", 403);
      }
      const cp = await db
        .select()
        .from(contestProblems)
        .where(
          and(
            eq(contestProblems.contestId, effectiveContestId),
            eq(contestProblems.problemId, id),
            eq(contestProblems.organizationId, organization.organizationId),
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
        .where(and(eq(contestProblems.problemId, id), eq(contestProblems.organizationId, organization.organizationId)));

      let found: number | null = null;
      for (const { contestId: cid } of liveContests) {
        const contestRows = await db.select().from(contests).where(and(
          eq(contests.id, cid),
          eq(contests.organizationId, organization.organizationId),
        )).limit(1);
        if (contestRows.length === 0 || contestRows[0].status !== "live") continue;
        if (Date.now() < new Date(contestRows[0].startsAt).getTime() || Date.now() >= contestRows[0].endsAt.getTime()) continue;
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

  // Hide editorial / explanation during live contests to protect competitive integrity.
  // Explanations are only visible in public practice mode or after a contest ends.
  const hideExplanation =
    problem.status === "contest_active" || contestIdToReturn !== null;

  const response: Record<string, unknown> = {
    id: problem.id,
    title: problem.title,
    statement: problem.statement,
    inputFormat: problem.inputFormat,
    outputFormat: problem.outputFormat,
    constraints: problem.constraints,
    explanation: hideExplanation ? null : problem.explanation,
    difficulty: problem.difficulty,
    tags: problem.tags,
    timeLimitMs: problem.timeLimitMs,
    memoryMb: problem.memoryLimitMb,
    outputComparator: problem.outputComparator,
    absoluteTolerance: problem.absoluteTolerance,
    relativeTolerance: problem.relativeTolerance,
    hasSpecialChecker: problem.checkerCode !== null,
    status: problem.status,
    samples: sampleRows.map((r) => ({ input: r.input, expectedOutput: r.expectedOutput })),
  };
  if (contestIdToReturn !== null) {
    response.contestId = contestIdToReturn;
  }

  return NextResponse.json(response);
}

export const GET = withApiGuard(handleGET);
