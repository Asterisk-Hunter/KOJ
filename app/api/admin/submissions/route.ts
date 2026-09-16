import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { problems, submissions, users } from "@/db/schema";
import { requireAdmin } from "@/app/api/admin/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin: browse all submissions with optional filters.
 * Query params: ?userId=&problemId=&status=&q=&limit=&offset=
 */
export async function GET(req: NextRequest) {
  const grant = await requireAdmin();
  if (!grant.ok) return grant.response;

  const url = req.nextUrl;
  const userIdFilter = url.searchParams.get("userId");
  const problemIdRaw = url.searchParams.get("problemId");
  const statusFilter = url.searchParams.get("status");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  const conditions = [];

  if (userIdFilter) {
    conditions.push(eq(submissions.userId, userIdFilter));
  }
  if (problemIdRaw) {
    const pid = Number(problemIdRaw);
    if (Number.isInteger(pid) && pid > 0) {
      conditions.push(eq(submissions.problemId, pid));
    }
  }
  if (statusFilter) {
    conditions.push(eq(submissions.status, statusFilter as typeof submissions.status.enumValues[number]));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: submissions.id,
      userId: submissions.userId,
      problemId: submissions.problemId,
      contestId: submissions.contestId,
      language: submissions.language,
      status: submissions.status,
      passedTests: submissions.passedTests,
      totalTests: submissions.totalTests,
      executionTimeMs: submissions.executionTimeMs,
      submittedAt: submissions.submittedAt,
      completedAt: submissions.completedAt,
      username: users.username,
      problemTitle: problems.title,
    })
    .from(submissions)
    .leftJoin(users, eq(submissions.userId, users.clerkId))
    .leftJoin(problems, eq(submissions.problemId, problems.id))
    .where(where)
    .orderBy(desc(submissions.submittedAt))
    .limit(limit)
    .offset(offset);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(submissions)
    .where(where);

  return NextResponse.json({
    submissions: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      username: r.username ?? r.userId.slice(0, 12),
      problemId: r.problemId,
      problemTitle: r.problemTitle ?? `Problem #${r.problemId}`,
      contestId: r.contestId,
      language: r.language,
      status: r.status,
      passedTests: r.passedTests,
      totalTests: r.totalTests,
      executionTimeMs: r.executionTimeMs,
      submittedAt: r.submittedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    })),
    total: countRow?.count ?? 0,
    limit,
    offset,
  });
}
