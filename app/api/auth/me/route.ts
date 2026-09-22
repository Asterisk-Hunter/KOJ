import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ensureUserRow } from "@/app/api/admin/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DbRole = "admin" | "setter" | "contestant";

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

  // Safety net for signups the Clerk webhook missed: the nav calls this on
  // every page load, so a missing row self-heals on next visit.
  if (rows.length === 0) {
    await ensureUserRow(userId);
    const retry = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.clerkId, userId))
      .limit(1);
    const role: DbRole = retry.length > 0 ? retry[0].role : "contestant";
    const canAuthor = role === "admin" || role === "setter";
    const canManageContests = role === "admin" || role === "setter";
    return NextResponse.json({
      authenticated: true,
      role,
      canAccessAdmin: canAuthor || canManageContests,
      canAuthor,
      canManageContests,
    });
  }

  const role: DbRole = rows[0].role;
  const canAuthor = role === "admin" || role === "setter";
  const canManageContests = role === "admin" || role === "setter";

  return NextResponse.json({
    authenticated: true,
    role,
    canAccessAdmin: canAuthor || canManageContests,
    canAuthor,
    canManageContests,
  });
}
