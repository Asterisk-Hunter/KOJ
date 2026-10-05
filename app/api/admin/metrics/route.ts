import { withApiGuard } from "@/app/api/guard";
import { NextResponse } from "next/server";
import { and, asc, desc, eq, gte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { contests, judgeJobs, judgeWorkers, submissions, users } from "@/db/schema";
import { requireAdmin } from "@/app/api/admin/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin: judge + submission observability — verdict distribution
 * (all-time + last 24h), average judge latency, recent failures.
 */
async function handleGET() {
  const grant = await requireAdmin();
  if (!grant.ok) return grant.response;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const workerSince = new Date(Date.now() - 2 * 60 * 1000);
  const [allTime, last24h, avgRow, failures, contestRow, infraRows, totalRows, queueRows, oldestQueued, workers] = await Promise.all([
    db
      .select({
        status: submissions.status,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(submissions)
      .groupBy(submissions.status),
    db
      .select({
        status: submissions.status,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(submissions)
      .where(gte(submissions.submittedAt, since))
      .groupBy(submissions.status),
    db
      .select({
        avgMs: sql<number | null>`avg(${submissions.executionTimeMs})`.mapWith(Number),
        p50Ms: sql<number | null>`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${submissions.executionTimeMs})`,
        p95Ms: sql<number | null>`percentile_cont(0.95) WITHIN GROUP (ORDER BY ${submissions.executionTimeMs})`,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(submissions)
      .where(
        and(
          ne(submissions.status, "pending"),
          ne(submissions.status, "running"),
          gte(submissions.submittedAt, since),
        ),
      ),
    db
      .select({
        id: submissions.id,
        problemId: submissions.problemId,
        contestId: submissions.contestId,
        status: submissions.status,
        errorMessage: submissions.errorMessage,
        submittedAt: submissions.submittedAt,
      })
      .from(submissions)
      .where(
        and(
          ne(submissions.status, "accepted"),
          ne(submissions.status, "pending"),
          ne(submissions.status, "running"),
        ),
      )
      .orderBy(desc(submissions.submittedAt))
      .limit(10),
    db
      .select({ status: contests.status, count: sql<number>`count(*)`.mapWith(Number) })
      .from(contests)
      .groupBy(contests.status),
    db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(submissions)
      .where(and(eq(submissions.judgeInfraError, true), gte(submissions.submittedAt, since))),
    db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(submissions)
      .where(gte(submissions.submittedAt, since)),
    db
      .select({ status: judgeJobs.status, count: sql<number>`count(*)`.mapWith(Number) })
      .from(judgeJobs)
      .groupBy(judgeJobs.status),
    db
      .select({ createdAt: judgeJobs.createdAt })
      .from(judgeJobs)
      .where(eq(judgeJobs.status, "queued"))
      .orderBy(asc(judgeJobs.createdAt))
      .limit(1),
    db
      .select({
        id: judgeWorkers.id,
        hostname: judgeWorkers.hostname,
        status: judgeWorkers.status,
        activeJobId: judgeWorkers.activeJobId,
        lastJobId: judgeWorkers.lastJobId,
        lastSeenAt: judgeWorkers.lastSeenAt,
      })
      .from(judgeWorkers)
      .where(gte(judgeWorkers.lastSeenAt, workerSince))
      .orderBy(desc(judgeWorkers.lastSeenAt)),
  ]);

  const recentSubmissions = await db
    .select({
      id: submissions.id,
      username: users.username,
      language: submissions.language,
      problemId: submissions.problemId,
      contestId: submissions.contestId,
      status: submissions.status,
      executionTimeMs: submissions.executionTimeMs,
      submittedAt: submissions.submittedAt,
    })
    .from(submissions)
    .innerJoin(users, eq(submissions.userId, users.clerkId))
    .orderBy(desc(submissions.submittedAt))
    .limit(10);

  const byStatus: Record<string, number> = {};
  for (const r of allTime) byStatus[r.status] = r.count;
  const last24hByStatus: Record<string, number> = {};
  for (const r of last24h) last24hByStatus[r.status] = r.count;

  const judgeDown24h = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(submissions)
    .where(
      and(
        eq(submissions.errorMessage, "judge unavailable"),
        gte(submissions.submittedAt, since),
      ),
    );

  const queueByStatus = Object.fromEntries(queueRows.map((row) => [row.status, row.count]));
  const infraFailures24h = infraRows[0]?.count ?? 0;
  const submitted24h = totalRows[0]?.count ?? 0;

  return NextResponse.json({
    window: "24h",
    allTimeByStatus: byStatus,
    last24hByStatus,
    judgedLast24h: avgRow[0]?.count ?? 0,
    avgExecutionMsLast24h:
      avgRow[0]?.avgMs === null || avgRow[0]?.avgMs === undefined
        ? null
        : Math.round(avgRow[0].avgMs),
    p50ExecutionMsLast24h:
      avgRow[0]?.p50Ms === null || avgRow[0]?.p50Ms === undefined
        ? null
        : Math.round(avgRow[0].p50Ms),
    p95ExecutionMsLast24h:
      avgRow[0]?.p95Ms === null || avgRow[0]?.p95Ms === undefined
        ? null
        : Math.round(avgRow[0].p95Ms),
    judgeUnavailableLast24h: judgeDown24h[0]?.count ?? 0,
    infraFailures24h,
    infraFailureRate24h: submitted24h === 0 ? 0 : infraFailures24h / submitted24h,
    queue: {
      byStatus: queueByStatus,
      oldestQueuedWaitMs: oldestQueued[0]
        ? Math.max(0, Date.now() - oldestQueued[0].createdAt.getTime())
        : null,
      activeWorkers: workers.filter((worker) => worker.status !== "stopping").length,
      workers: workers.map((worker) => ({
        id: worker.id,
        hostname: worker.hostname,
        status: worker.status,
        activeJobId: worker.activeJobId,
        lastJobId: worker.lastJobId,
        lastSeenAt: worker.lastSeenAt.toISOString(),
      })),
    },
    contestsByStatus: Object.fromEntries(contestRow.map((r) => [r.status, r.count])),
    recentSubmissions: recentSubmissions.map((s) => ({
      id: s.id,
      username: s.username,
      language: s.language,
      problemId: s.problemId,
      contestId: s.contestId,
      status: s.status,
      executionTimeMs: s.executionTimeMs,
      submittedAt: s.submittedAt?.toISOString() ?? null,
    })),
    recentFailures: failures.map((f) => ({
      id: f.id,
      problemId: f.problemId,
      contestId: f.contestId,
      status: f.status,
      errorMessage: f.errorMessage?.slice(0, 300) ?? null,
      submittedAt: f.submittedAt?.toISOString() ?? null,
    })),
  });
}

export const GET = withApiGuard(handleGET);
