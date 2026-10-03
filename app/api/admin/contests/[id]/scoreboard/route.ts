import { NextRequest } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { contests, submissions } from "@/db/schema";
import { jsonError, requireContestManager } from "@/app/api/admin/authz";
import { getRedis } from "@/lib/redis";
import { MAX_CONTEST_REGISTRATION_BODY_BYTES, readBoundedJsonObject } from "@/app/api/body-guard";
import { settleExpiredContests } from "@/app/api/contests/lifecycle";
import { recordAdminAuditEvent } from "@/app/api/admin/audit-logs/writer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const grant = await requireContestManager();
  if (!grant.ok) return grant.response;
  await settleExpiredContests();
  const contestId = Number((await ctx.params).id);
  if (!Number.isInteger(contestId) || contestId <= 0) return jsonError("invalid contest id", 400);
  const parsed = await readBoundedJsonObject(req, MAX_CONTEST_REGISTRATION_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const action = parsed.value.action;
  const [contest] = await db.select().from(contests).where(eq(contests.id, contestId)).limit(1);
  if (!contest) return jsonError("contest not found", 404);
  const now = new Date();
  if (action === "freeze" || action === "unfreeze") {
    if (contest.status !== "live") return jsonError("freeze controls are available only while live", 409);
    if (now < contest.startsAt || now >= contest.endsAt) return jsonError("freeze controls are available only during the contest window", 409);
    await db.transaction(async (tx) => {
      await tx.update(contests).set({
        scoreboardFreezeMode: action === "freeze" ? "frozen" : "unfrozen",
        scoreboardFrozenAt: action === "freeze" ? now : null,
        ...(action === "freeze" ? { scoreboardRevealCount: 0 } : {}),
        updatedAt: now,
      }).where(eq(contests.id, contestId));
      await recordAdminAuditEvent(tx, {
        actorId: grant.userId,
        action: action === "freeze" ? "contest.scoreboard_frozen" : "contest.scoreboard_unfrozen",
        entityType: "contest",
        entityId: contestId,
        metadata: { status: contest.status },
      });
    });
  } else if (action === "reveal-next" || action === "reveal-all") {
    if (contest.status !== "ended" && contest.status !== "archived") return jsonError("staged reveal is available after contest end", 409);
    if (contest.scoreboardFreezeMode !== "frozen" || contest.scoreboardFrozenAt === null) return jsonError("freeze the scoreboard during the contest before revealing results", 409);
    const frozenAt = contest.scoreboardFrozenAt;
    if (action === "reveal-all") {
      await db.transaction(async (tx) => {
        const [{ count }] = await tx.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(submissions)
          .where(and(eq(submissions.contestId, contestId), eq(submissions.mode, "submit"), eq(submissions.participation, "official"), gte(submissions.submittedAt, frozenAt)));
        await tx.update(contests).set({ scoreboardRevealCount: count, updatedAt: now }).where(eq(contests.id, contestId));
        await recordAdminAuditEvent(tx, {
          actorId: grant.userId,
          action: "contest.scoreboard_reveal_all",
          entityType: "contest",
          entityId: contestId,
          metadata: { count },
        });
      });
    } else {
      await db.transaction(async (tx) => {
        const [updated] = await tx.update(contests)
          .set({ scoreboardRevealCount: sql`${contests.scoreboardRevealCount} + 1`, updatedAt: now })
          .where(eq(contests.id, contestId))
          .returning({ count: contests.scoreboardRevealCount });
        await recordAdminAuditEvent(tx, {
          actorId: grant.userId,
          action: "contest.scoreboard_reveal_next",
          entityType: "contest",
          entityId: contestId,
          metadata: { count: updated.count },
        });
      });
    }
  } else {
    return jsonError("action must be freeze, unfreeze, reveal-next, or reveal-all", 400);
  }
  const redis = getRedis();
  if (redis) {
    try { await redis.del(`standings:${contestId}:official`, `standings:${contestId}:virtual`); } catch { /* Cache is best effort. */ }
  }
  return Response.json({ ok: true });
}
