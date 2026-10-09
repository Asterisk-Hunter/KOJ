import { withApiGuard } from "@/app/api/guard";
import { auth } from "@clerk/nextjs/server";
import { and, count, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { recordAdminAuditEvent } from "@/app/api/admin/audit-logs/writer";
import { db } from "@/db";
import { organizationMemberships, organizations } from "@/db/schema";
import { canLeaveOrganization } from "@/lib/organization-policy";
import { resolveOrganizationContext } from "@/lib/organizations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleDELETE(_request: NextRequest, route: { params: Promise<{ slug: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { slug } = await route.params;
  const context = await resolveOrganizationContext(userId, slug);
  if (!context) return NextResponse.json({ error: "organization not found" }, { status: 404 });

  const result = await db.transaction(async (tx) => {
    await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, context.organizationId))
      .for("update");
    const [membership] = await tx
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(and(
        eq(organizationMemberships.organizationId, context.organizationId),
        eq(organizationMemberships.userId, userId),
      ))
      .limit(1);
    if (!membership) return { error: "membership not found", status: 404 as const };

    const [adminCount] = await tx
      .select({ value: count() })
      .from(organizationMemberships)
      .where(and(
        eq(organizationMemberships.organizationId, context.organizationId),
        eq(organizationMemberships.role, "admin"),
      ));
    if (!canLeaveOrganization(membership.role, adminCount.value)) {
      return { error: "transfer organization admin before leaving", status: 409 as const };
    }

    await tx.delete(organizationMemberships).where(and(
      eq(organizationMemberships.organizationId, context.organizationId),
      eq(organizationMemberships.userId, userId),
    ));
    await recordAdminAuditEvent(tx, {
      organizationId: context.organizationId,
      actorId: userId,
      action: "organization.member_leave",
      entityType: "organization_membership",
      entityId: userId,
      metadata: { organizationId: context.organizationId, previousRole: membership.role },
    });
    return { left: true };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}

export const DELETE = withApiGuard(handleDELETE);
