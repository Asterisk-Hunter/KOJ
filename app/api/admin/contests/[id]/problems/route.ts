import { withApiGuard } from "@/app/api/guard";
import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { contestProblems, problems } from "@/db/schema";
import { jsonError, requireContestManager } from "@/app/api/admin/authz";
import { MAX_CONTEST_PROBLEM_LINK_BODY_BYTES, readBoundedJsonObject } from "@/app/api/body-guard";
import { recordAdminAuditEvent } from "@/app/api/admin/audit-logs/writer";
import { withLockedContest } from "@/app/api/admin/contests/mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin: add an existing draft problem to a draft contest (BR-04). */
async function handlePOST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const grant = await requireContestManager();
  if (!grant.ok) return grant.response;
  const parsed = await readBoundedJsonObject(req, MAX_CONTEST_PROBLEM_LINK_BODY_BYTES, "invalid json");
  if (!parsed.ok) return parsed.response;
  const problemId = parsed.value.problemId;
  if (typeof problemId !== "number" || !Number.isSafeInteger(problemId) || problemId <= 0) {
    return jsonError("problemId must be a positive integer", 400);
  }
  const requestedPosition = parsed.value.position;
  if (requestedPosition !== undefined && (typeof requestedPosition !== "number" || !Number.isSafeInteger(requestedPosition) || requestedPosition < 0)) {
    return jsonError("position must be a non-negative integer", 400);
  }
  return withLockedContest((await ctx.params).id, grant.context.organizationId, async (tx, contest) => {
    if (contest.status !== "draft") return jsonError("problems can only be added to draft contests", 400);
    const [problem] = await tx.select({ id: problems.id, status: problems.status }).from(problems)
      .where(and(eq(problems.id, problemId), eq(problems.organizationId, grant.context.organizationId)))
      .limit(1).for("update");
    if (!problem) return jsonError("problem not found", 404);
    if (problem.status !== "draft") return jsonError("only draft problems can be added to a contest (BR-04)", 400);
    const [existingLink] = await tx.select({ contestId: contestProblems.contestId }).from(contestProblems)
      .where(and(eq(contestProblems.problemId, problemId), eq(contestProblems.organizationId, grant.context.organizationId))).limit(1);
    if (existingLink) {
      return jsonError(existingLink.contestId === contest.id ? "problem already in contest" : "problem already linked to another contest", 409);
    }

    let position = requestedPosition;
    if (position === undefined) {
      const [row] = await tx.select({ max: sql<number | null>`max(${contestProblems.position})`.mapWith(Number) })
        .from(contestProblems).where(eq(contestProblems.contestId, contest.id));
      position = (row?.max ?? -1) + 1;
    }
    await tx.insert(contestProblems).values({ organizationId: grant.context.organizationId, contestId: contest.id, problemId, position });
    await recordAdminAuditEvent(tx, {
      organizationId: grant.context.organizationId, actorId: grant.userId,
      action: "contest.problem_linked", entityType: "contest", entityId: contest.id,
      metadata: { count: 1, problemId },
    });
    return NextResponse.json({ contestId: contest.id, problemId, position }, { status: 201 });
  });
}

/** Admin: remove a problem from a draft contest. */
async function handleDELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const grant = await requireContestManager();
  if (!grant.ok) return grant.response;
  const problemId = Number(req.nextUrl.searchParams.get("problemId"));
  if (!Number.isSafeInteger(problemId) || problemId <= 0) return jsonError("problemId query param must be a positive integer", 400);
  return withLockedContest((await ctx.params).id, grant.context.organizationId, async (tx, contest) => {
    if (contest.status !== "draft") return jsonError("problems can only be removed from draft contests", 400);
    const deleted = await tx.delete(contestProblems).where(and(
      eq(contestProblems.contestId, contest.id), eq(contestProblems.problemId, problemId),
      eq(contestProblems.organizationId, grant.context.organizationId),
    )).returning({ problemId: contestProblems.problemId });
    if (deleted.length === 0) return jsonError("problem not in contest", 404);
    const remaining = await tx.select({ problemId: contestProblems.problemId }).from(contestProblems)
      .where(eq(contestProblems.contestId, contest.id)).orderBy(asc(contestProblems.position), asc(contestProblems.problemId));
    for (let i = 0; i < remaining.length; i++) {
      await tx.update(contestProblems).set({ position: i }).where(and(
        eq(contestProblems.contestId, contest.id), eq(contestProblems.problemId, remaining[i].problemId),
      ));
    }
    await recordAdminAuditEvent(tx, {
      organizationId: grant.context.organizationId, actorId: grant.userId,
      action: "contest.problem_unlinked", entityType: "contest", entityId: contest.id,
      metadata: { count: 1, problemId },
    });
    return NextResponse.json({ removed: true });
  });
}

export const POST = withApiGuard(handlePOST);
export const DELETE = withApiGuard(handleDELETE);
