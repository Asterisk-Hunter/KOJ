import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contests, problems, submissions, users } from "@/db/schema";
import { requireStaff } from "@/app/api/admin/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const grant = await requireStaff();
  if (!grant.ok) return grant.response;

  const [usersCountRow] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(users);
  const [problemsCountRow] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(problems);
  const [contestsCountRow] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(contests);
  const [submissionsCountRow] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(submissions);

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
    grant.role === "problem_setter"
      ? problemQuery.where(eq(problems.authorId, grant.userId))
      : problemQuery
  )
    .orderBy(desc(problems.createdAt))
    .limit(10);

  const recentUsers =
    grant.role === "admin"
      ? await db
          .select({
            clerkId: users.clerkId,
            username: users.username,
            email: users.email,
            role: users.role,
            createdAt: users.createdAt,
          })
          .from(users)
          .orderBy(desc(users.createdAt))
          .limit(5)
      : [];

  return NextResponse.json({
    role: grant.role,
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
    recentUsers: recentUsers.map((u) => ({
      clerkId: u.clerkId,
      username: u.username,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
    })),
  });
}
