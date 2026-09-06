import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contests, problems, submissions, users } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function isAuthorized(userId: string): Promise<boolean> {
  const authObj = await auth();
  // Clerk org:admin check
  let clerkAdmin = false;
  try {
    const hasFn = (authObj as unknown as { has?: (arg: unknown) => Promise<boolean> | boolean }).has;
    if (typeof hasFn === "function") {
      const res = hasFn.call(authObj, { role: "org:admin" });
      clerkAdmin = res instanceof Promise ? await res : Boolean(res);
    }
  } catch {
    clerkAdmin = false;
  }
  if (clerkAdmin) return true;

  const rows = await db.select().from(users).where(eq(users.clerkId, userId)).limit(1);
  if (rows.length > 0 && rows[0].role === "admin") return true;
  return false;
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return jsonError("unauthorized", 401);
  }
  const authorized = await isAuthorized(userId);
  if (!authorized) {
    return jsonError("forbidden", 403);
  }

  const [usersCountRow] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(users);
  const [problemsCountRow] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(problems);
  const [contestsCountRow] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(contests);
  const [submissionsCountRow] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(submissions);

  const recentProblems = await db
    .select({
      id: problems.id,
      title: problems.title,
      difficulty: problems.difficulty,
      status: problems.status,
      createdAt: problems.createdAt,
    })
    .from(problems)
    .orderBy(desc(problems.createdAt))
    .limit(5);

  const recentUsers = await db
    .select({
      clerkId: users.clerkId,
      username: users.username,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(5);

  return NextResponse.json({
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
