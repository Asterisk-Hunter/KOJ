import { withApiGuard } from "@/app/api/guard";
import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contests, organizationMemberships, problems, submissions } from "@/db/schema";
import { requireAdmin, requireStaff } from "@/app/api/admin/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET() {
  const grant = await requireStaff();
  if (!grant.ok) return grant.response;
  const platformGrant = await requireAdmin();

  const organizationId = grant.context.organizationId;
  const [usersCountRow] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(organizationMemberships).where(eq(organizationMemberships.organizationId, organizationId));
  const [problemsCountRow] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(problems).where(eq(problems.organizationId, organizationId));
  const [contestsCountRow] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(contests).where(eq(contests.organizationId, organizationId));
  const [submissionsCountRow] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(submissions).where(eq(submissions.organizationId, organizationId));

  const problemQuery = db
    .select({
      id: problems.id,
      title: problems.title,
      difficulty: problems.difficulty,
      status: problems.status,
      createdAt: problems.createdAt,
    })
    .from(problems);

  const recentProblems = await (
    grant.role === "setter"
      ? problemQuery.where(and(
          eq(problems.authorId, grant.userId),
          eq(problems.organizationId, organizationId),
        ))
      : problemQuery.where(eq(problems.organizationId, organizationId))
  )
    .orderBy(desc(problems.createdAt))
    .limit(10);

  return NextResponse.json({
    role: grant.role,
    isPlatformAdmin: platformGrant.ok,
    counts: {
      users: usersCountRow?.count ?? 0,
      problems: problemsCountRow?.count ?? 0,
      contests: contestsCountRow?.count ?? 0,
      submissions: submissionsCountRow?.count ?? 0,
    },
    recentProblems: recentProblems.map((p) => ({
      id: p.id,
      title: p.title,
      difficulty: p.difficulty,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
    })),
  });
}

export const GET = withApiGuard(handleGET);
