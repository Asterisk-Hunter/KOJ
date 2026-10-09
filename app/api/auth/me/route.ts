import { withApiGuard } from "@/app/api/guard";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ensureUserRow } from "@/app/api/admin/authz";
import { resolveOrganizationContext } from "@/lib/organizations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DbRole = "admin" | "setter" | "contestant";

async function handleGET() {
  const session = await auth();
  const userId = session.isAuthenticated ? session.userId : null;
  if (!userId) {
    return NextResponse.json({
      authenticated: false,
      role: "contestant" as const,
      canAccessAdmin: false,
      canAuthor: false,
      canManageContests: false,
    });
  }

  const [existingUser] = await db.select({ clerkId: users.clerkId }).from(users).where(eq(users.clerkId, userId)).limit(1);
  if (!existingUser && !await ensureUserRow(userId)) {
    return NextResponse.json({ error: "unable to synchronize account" }, { status: 503 });
  }
  const organization = await resolveOrganizationContext(userId);
  const role: DbRole = organization?.role ?? "contestant";
  const active = organization !== null && !organization.suspended;
  const canAuthor = active && (role === "admin" || role === "setter");
  const canManageContests = active && (role === "admin" || role === "setter");

  return NextResponse.json({
    authenticated: true,
    role,
    suspended: organization?.suspended ?? false,
    organization: organization ? { slug: organization.slug, name: organization.name, isPublic: organization.isPublic } : null,
    canAccessAdmin: canAuthor || canManageContests,
    canAuthor,
    canManageContests,
  });
}

export const GET = withApiGuard(handleGET);
