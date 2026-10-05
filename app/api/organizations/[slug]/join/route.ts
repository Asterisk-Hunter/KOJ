import { withApiGuard } from "@/app/api/guard";
import { auth } from "@clerk/nextjs/server";
import { and, count, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { ensureUserRow } from "@/app/api/admin/authz";
import { recordAdminAuditEvent } from "@/app/api/admin/audit-logs/writer";
import { db } from "@/db";
import { organizationMemberships, organizations, users } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(_request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { slug } = await context.params;
  if (!(await ensureUserRow(userId))) {
    return NextResponse.json({ error: "failed to resolve user" }, { status: 500 });
  }

  const [organization] = await db
    .select({ id: organizations.id, slug: organizations.slug, isPublic: organizations.isPublic })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  if (!organization || !organization.isPublic) {
    return NextResponse.json({ error: "public organization not found" }, { status: 404 });
  }
  const [user] = await db
    .select({ suspended: users.suspended })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);
  if (!user || user.suspended) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const result = await db.transaction(async (tx) => {
    const [lockedUser] = await tx
      .select({ clerkId: users.clerkId, suspended: users.suspended })
      .from(users)
      .where(eq(users.clerkId, userId))
      .for("update");
    if (!lockedUser || lockedUser.suspended) return { error: "forbidden", status: 403 as const };
    const [existing] = await tx
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(and(
        eq(organizationMemberships.organizationId, organization.id),
        eq(organizationMemberships.userId, userId),
      ))
      .limit(1);
    if (existing) return { role: existing.role, joined: false };

    const [memberCount] = await tx
      .select({ value: count() })
      .from(organizationMemberships)
      .where(eq(organizationMemberships.userId, userId));
    if (memberCount.value >= 10) return { error: "organization membership limit reached", status: 409 as const };

    const inserted = await tx
      .insert(organizationMemberships)
      .values({ organizationId: organization.id, userId, role: "contestant" })
      .onConflictDoNothing()
      .returning({ role: organizationMemberships.role });
    if (inserted[0]) {
      await recordAdminAuditEvent(tx, {
        organizationId: organization.id,
        actorId: userId,
        action: "organization.join",
        entityType: "organization_membership",
        entityId: userId,
        metadata: { organizationId: organization.id, role: "contestant" },
      });
      return { role: inserted[0].role, joined: true };
    }
    return { role: "contestant", joined: false };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ organization: organization.slug, ...result });
}

export const POST = withApiGuard(handlePOST);
