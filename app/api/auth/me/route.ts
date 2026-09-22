import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DbRole = "admin" | "problem_setter" | "contest_setter" | "contestant";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({
      authenticated: false,
      role: "contestant" as const,
      canAccessAdmin: false,
      canAuthor: false,
      canManageContests: false,
    });
  }

  const rows = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);

  const role: DbRole = rows.length > 0 ? rows[0].role : "contestant";
  const canAuthor = role === "admin" || role === "problem_setter";
  const canManageContests = role === "admin" || role === "contest_setter";

  return NextResponse.json({
    authenticated: true,
    role,
    canAccessAdmin: canAuthor || canManageContests,
    canAuthor,
    canManageContests,
  });
}
