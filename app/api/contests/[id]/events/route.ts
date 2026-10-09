import { withApiGuard } from "@/app/api/guard";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contestRegistrations, contests, submissions } from "@/db/schema";
import { getRedis } from "@/lib/redis";
import { auth } from "@clerk/nextjs/server";
import { resolveOrganizationContext } from "@/lib/organizations";
import { getScoreboardFreezeAt, type FreezeMode } from "@/app/api/contests/scoreboard-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TICK_MS = 2000;
const MAX_TICKS = 25; // 50 seconds; EventSource reconnects automatically.

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function findContest(idRaw: string, organizationId: number) {
  const numeric = Number(idRaw);
  const isNumeric = Number.isInteger(numeric) && numeric > 0 && String(numeric) === idRaw;
  if (isNumeric) {
    const rows = await db.select().from(contests).where(and(
      eq(contests.id, numeric),
      eq(contests.organizationId, organizationId),
    )).limit(1);
    if (rows.length > 0) return rows[0];
  }
  const slugRows = await db.select().from(contests).where(and(
    eq(contests.slug, idRaw),
    eq(contests.organizationId, organizationId),
  )).limit(1);
  if (slugRows.length > 0) return slugRows[0];
  return null;
}

type ContestVersion = {
  count: number;
  maxSubmittedAt: string | null;
  maxCompletedAt: string | null;
  judgedCount: number;
  contestUpdatedAt: string;
  startsAt: string;
  endsAt: string;
  status: string;
  freezeAt: string | null;
  freezeMode: FreezeMode;
  revealCount: number;
};

function timestampValue(value: unknown): string | null {
  return value instanceof Date ? value.toISOString() : typeof value === "string" ? value : null;
}

async function versionFor(contestId: number, organizationId: number, participation: "official" | "virtual"): Promise<ContestVersion> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)`.mapWith(Number),
      maxSubmittedAt: sql<string | null>`max(${submissions.submittedAt})`.mapWith(timestampValue),
      maxCompletedAt: sql<string | null>`max(${submissions.completedAt})`.mapWith(timestampValue),
      judgedCount: sql<number>`count(${submissions.completedAt})`.mapWith(Number),
    })
    .from(submissions)
    .where(and(
      eq(submissions.contestId, contestId), eq(submissions.organizationId, organizationId),
      eq(submissions.mode, "submit"), eq(submissions.participation, participation),
    ));
  const [contest] = await db.select({
    updatedAt: contests.updatedAt, status: contests.status, startsAt: contests.startsAt, endsAt: contests.endsAt,
    freezeMode: contests.scoreboardFreezeMode, frozenAt: contests.scoreboardFrozenAt, revealCount: contests.scoreboardRevealCount,
  }).from(contests).where(and(eq(contests.id, contestId), eq(contests.organizationId, organizationId))).limit(1);
  if (!contest || contest.status === "draft") throw new Error("contest is no longer visible");
  return {
    count: row?.count ?? 0, maxSubmittedAt: row?.maxSubmittedAt ?? null,
    maxCompletedAt: row?.maxCompletedAt ?? null, judgedCount: row?.judgedCount ?? 0,
    contestUpdatedAt: contest.updatedAt.toISOString(),
    startsAt: contest.startsAt.toISOString(), endsAt: contest.endsAt.toISOString(), status: contest.status,
    freezeAt: getScoreboardFreezeAt(contest.freezeMode, contest.frozenAt, contest.startsAt, contest.endsAt)?.toISOString() ?? null,
    freezeMode: contest.freezeMode, revealCount: contest.revealCount,
  };
}

/**
 * Live leaderboard ticker (SRS REQ-LB-03/04, Redis-free v1): streams a
 * `version` event every 2s. Clients refetch `GET /api/rankings` only when
 * the version changes — push-triggered refresh without polling the full
 * standings. Redis pub/sub remains the documented v2 upgrade for
 * cross-instance fan-out.
 */
async function handleGET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: idRaw } = await ctx.params;
  const { userId } = await auth();
  const organization = await resolveOrganizationContext(userId);
  if (!organization) return jsonError("organization not found", 404);
  if (organization.suspended) return jsonError("account suspended", 403);
  const contest = await findContest(idRaw, organization.organizationId);
  if (
    !contest ||
    (contest.status !== "live" && contest.status !== "ended" && contest.status !== "archived")
  ) {
    return jsonError("contest not found or not visible", 404);
  }
  const now = Date.now();
  if (now < contest.startsAt.getTime()) return jsonError("contest has not started", 403);
  if (contest.status === "live" && now < contest.endsAt.getTime()) {
    if (!userId) return jsonError("not registered for contest", 403);
    const [registration] = await db.select({ userId: contestRegistrations.userId }).from(contestRegistrations)
      .where(and(eq(contestRegistrations.contestId, contest.id), eq(contestRegistrations.userId, userId))).limit(1);
    if (!registration) return jsonError("not registered for contest", 403);
  }
  const virtualRaw = req.nextUrl.searchParams.get("virtual");
  if (virtualRaw !== null && virtualRaw !== "0" && virtualRaw !== "1") {
    return jsonError("virtual must be 0 or 1", 400);
  }
  const participation = virtualRaw === "1" ? "virtual" : "official";
  if (participation === "virtual" && contest.status === "live") {
    return jsonError("virtual standings are available after the contest ends", 409);
  }
  const contestId = contest.id;

  const encoder = new TextEncoder();
  let ticks = 0;
  let closed = false;
  let tickInFlight = false;
  let timer: NodeJS.Timeout | null = null;
  const redis = getRedis();
  const versionCacheKey = `contest_version:${organization.organizationId}:${contestId}:${participation}:v2`;
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const cleanup = () => {
    closed = true;
    if (timer) clearInterval(timer);
    timer = null;
    req.signal.removeEventListener("abort", abort);
  };
  const abort = () => {
    if (closed) return;
    cleanup();
    streamController?.close();
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      streamController = controller;
      req.signal.addEventListener("abort", abort, { once: true });
      if (req.signal.aborted) { abort(); return; }
      const send = (event: string, payload: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
        );
      };

      const fetchVersion = async (): Promise<ContestVersion | null> => {
        // Redis-first: check cached version
        if (redis) {
          try {
            const cached = await redis.get<ContestVersion>(versionCacheKey);
            if (closed) return null;
            if (cached) return cached;
          } catch {
            // Fall through to DB
          }
        }
        if (closed) return null;
        const v = await versionFor(contestId, organization.organizationId, participation);
        if (closed) return null;
        // Cache for 3 seconds to reduce DB load on fast tick
        if (redis) {
          try {
            await redis.set(versionCacheKey, v, { ex: 3 });
          } catch {
            // Best-effort
          }
        }
        return v;
      };

      let lastVersion: string | null = null;
      const notifyVersion = async () => {
        const snapshot = await fetchVersion();
        if (!snapshot || closed) return;
        const now = Date.now();
        const timePhase = now < new Date(snapshot.startsAt).getTime() ? "scheduled"
          : snapshot.status !== "live" || now >= new Date(snapshot.endsAt).getTime() ? "finished"
          : snapshot.freezeMode === "automatic" && snapshot.freezeAt !== null && now >= new Date(snapshot.freezeAt).getTime() ? "automatic-freeze"
          : "live";
        // Time-derived state must not be cached: crossing a boundary changes the
        // standings even when no submissions or lifecycle writes occur.
        const version = { ...snapshot, timePhase };
        const serialized = JSON.stringify(version);
        if (serialized !== lastVersion && redis) {
          try { await redis.del(`standings:${organization.organizationId}:${contestId}:${participation}`); } catch { /* Cache is best effort. */ }
        }
        lastVersion = serialized;
        send("version", version);
      };

      try {
        await notifyVersion();
        if (closed) return;
        timer = setInterval(() => {
          if (closed || tickInFlight) return;
          void (async () => {
            tickInFlight = true;
            ticks += 1;
            try {
              if (!closed) await notifyVersion();
            } catch {
              if (!closed) {
                cleanup();
                controller.close();
              }
              return;
            } finally {
              tickInFlight = false;
            }
            if (ticks >= MAX_TICKS) {
              if (!closed) {
                cleanup();
                controller.close();
              }
            }
          })();
        }, TICK_MS);
      } catch {
        if (!closed) {
          cleanup();
          controller.close();
        }
      }
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export const GET = withApiGuard(handleGET);
