import { NextResponse } from "next/server";
import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { contests, submissions, users } from "@/db/schema";
import { requireAdmin } from "@/app/api/admin/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin: judge + submission observability — verdict distribution
 * (all-time + last 24h), average judge latency, recent failures.
 */
export async function GET() {
  const grant = await requireAdmin();
  if (!grant.ok) return grant.response;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [allTime, last24h, avgRow, failures, contestRow] = await Promise.all([
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

  return NextResponse.json({
    window: "24h",
    allTimeByStatus: byStatus,
    last24hByStatus,
    judgedLast24h: avgRow[0]?.count ?? 0,
    avgExecutionMsLast24h:
      avgRow[0]?.avgMs === null || avgRow[0]?.avgMs === undefined
        ? null
        : Math.round(avgRow[0].avgMs),
    judgeUnavailableLast24h: judgeDown24h[0]?.count ?? 0,
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
