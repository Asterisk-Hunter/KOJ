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

  let user = await db
    .select({ role: users.role, suspended: users.suspended })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);

  // Safety net for signups the Clerk webhook missed: the nav calls this on
  // every page load, so a missing row self-heals on next visit.
  if (user.length === 0) {
    await ensureUserRow(userId);
    user = await db
      .select({ role: users.role, suspended: users.suspended })
      .from(users)
      .where(eq(users.clerkId, userId))
      .limit(1);
  }

  const role: DbRole = user.length > 0 ? user[0].role : "contestant";
  const active = user.length === 0 || !user[0].suspended;
  const canAuthor = active && (role === "admin" || role === "setter");
  const canManageContests = active && (role === "admin" || role === "setter");

  return NextResponse.json({
    authenticated: true,
    role,
    suspended: !active,
    canAccessAdmin: canAuthor || canManageContests,
    canAuthor,
    canManageContests,
  });
}
