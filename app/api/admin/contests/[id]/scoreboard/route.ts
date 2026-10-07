import { withApiGuard } from "@/app/api/guard";
import { NextRequest } from "next/server";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { contests, submissions } from "@/db/schema";
import { jsonError, requireContestManager } from "@/app/api/admin/authz";
import { getRedis } from "@/lib/redis";
import { MAX_CONTEST_REGISTRATION_BODY_BYTES, readBoundedJsonObject } from "@/app/api/body-guard";
import { settleExpiredContests } from "@/app/api/contests/lifecycle";
import { recordAdminAuditEvent } from "@/app/api/admin/audit-logs/writer";
import { withLockedContest } from "@/app/api/admin/contests/mutation";
import { isOfficialContestActive } from "@/app/api/contests/participation-policy";
import { getManualFreezeAt } from "@/app/api/contests/scoreboard-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const grant = await requireContestManager();
  if (!grant.ok) return grant.response;
  await settleExpiredContests(grant.context.organizationId);
  const { id } = await ctx.params;
  const parsed = await readBoundedJsonObject(req, MAX_CONTEST_REGISTRATION_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const action = parsed.value.action;
  const response = await withLockedContest(id, grant.context.organizationId, async (tx, contest) => {
    const now = new Date();
    let auditAction: string;
    let count: number | undefined;
    if (action === "freeze" || action === "unfreeze") {
      if (!isOfficialContestActive(contest, now)) return jsonError("freeze controls are available only during the contest window", 409);
      await tx.update(contests).set({
        scoreboardFreezeMode: action === "freeze" ? "frozen" : "unfrozen",
        scoreboardFrozenAt: action === "freeze" ? getManualFreezeAt(contest.scoreboardFreezeMode, contest.scoreboardFrozenAt, contest.startsAt, contest.endsAt, now) : null,
        ...(action === "freeze" ? { scoreboardRevealCount: 0 } : {}),
        updatedAt: now,
      }).where(eq(contests.id, contest.id));
      auditAction = action === "freeze" ? "contest.scoreboard_frozen" : "contest.scoreboard_unfrozen";
    } else if (action === "reveal-next" || action === "reveal-all") {
      if (contest.status !== "ended" && contest.status !== "archived") return jsonError("staged reveal is available after contest end", 409);
      if (contest.scoreboardFreezeMode !== "frozen" || contest.scoreboardFrozenAt === null) return jsonError("freeze the scoreboard during the contest before revealing results", 409);
      const [row] = await tx.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(submissions)
        .where(and(
          eq(submissions.organizationId, grant.context.organizationId), eq(submissions.contestId, contest.id),
          eq(submissions.mode, "submit"), eq(submissions.participation, "official"),
          gte(submissions.submittedAt, contest.scoreboardFrozenAt),
          gte(submissions.submittedAt, contest.startsAt), lt(submissions.submittedAt, contest.endsAt),
        ));
      const total = row?.count ?? 0;
      count = action === "reveal-all" ? total : Math.min(total, contest.scoreboardRevealCount + 1);
      await tx.update(contests).set({ scoreboardRevealCount: count, updatedAt: now }).where(eq(contests.id, contest.id));
      auditAction = action === "reveal-all" ? "contest.scoreboard_reveal_all" : "contest.scoreboard_reveal_next";
    } else {
      return jsonError("action must be freeze, unfreeze, reveal-next, or reveal-all", 400);
    }
    await recordAdminAuditEvent(tx, {
      organizationId: grant.context.organizationId, actorId: grant.userId,
      action: auditAction, entityType: "contest", entityId: contest.id,
      metadata: count === undefined ? { status: contest.status } : { count },
    });
    return Response.json({ ok: true });
  });
  if (response.ok) {
    const redis = getRedis();
    if (redis) {
      try {
        await redis.del(`standings:${grant.context.organizationId}:${Number(id)}:official`, `standings:${grant.context.organizationId}:${Number(id)}:virtual`);
      } catch { /* Cache is best effort. */ }
    }
  }
  return response;
}

export const POST = withApiGuard(handlePOST);
