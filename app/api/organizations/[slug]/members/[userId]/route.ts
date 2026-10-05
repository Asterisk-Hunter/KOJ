import { withApiGuard } from "@/app/api/guard";
import { and, count, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { organizationMemberships, organizations, users } from "@/db/schema";
import { MAX_ADMIN_USER_BODY_BYTES, readBoundedJsonObject } from "@/app/api/body-guard";
import { recordAdminAuditEvent } from "@/app/api/admin/audit-logs/writer";
import { canChangeMembershipRole, isOrganizationRole } from "@/lib/organization-policy";
import { requireOrganizationRole } from "@/lib/organizations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePATCH(request: NextRequest, context: { params: Promise<{ slug: string; userId: string }> }) {
  const { slug, userId } = await context.params;
  const grant = await requireOrganizationRole(["admin"], slug);
  if (!grant.ok) return grant.response;

  const parsed = await readBoundedJsonObject(request, MAX_ADMIN_USER_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const { role } = parsed.value;
  if (!isOrganizationRole(role)) return NextResponse.json({ error: "invalid role" }, { status: 400 });

  const result = await db.transaction(async (tx) => {
    await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, grant.context.organizationId))
      .for("update");
    const [actor] = await tx
      .select({ role: organizationMemberships.role, suspended: users.suspended })
      .from(organizationMemberships)
      .innerJoin(users, eq(organizationMemberships.userId, users.clerkId))
      .where(and(
        eq(organizationMemberships.organizationId, grant.context.organizationId),
        eq(organizationMemberships.userId, grant.userId),
      ))
      .limit(1);
    if (!actor || actor.suspended || actor.role !== "admin") {
      return { error: "forbidden", status: 403 as const };
    }
    const [target] = await tx
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(and(
        eq(organizationMemberships.organizationId, grant.context.organizationId),
        eq(organizationMemberships.userId, userId),
      ))
      .limit(1);
    if (!target) return { error: "member not found", status: 404 as const };

    const [adminCount] = await tx
      .select({ value: count() })
      .from(organizationMemberships)
      .where(and(
        eq(organizationMemberships.organizationId, grant.context.organizationId),
        eq(organizationMemberships.role, "admin"),
      ));
    if (!canChangeMembershipRole(actor.role, target.role, role, adminCount.value)) {
      return { error: "organization must retain an admin", status: 409 as const };
    }

    await recordAdminAuditEvent(tx, {
      organizationId: grant.context.organizationId,
      actorId: grant.userId,
      action: "organization.member_role_change",
      entityType: "organization_membership",
      entityId: userId,
      metadata: {
        organizationId: grant.context.organizationId,
        previousRole: target.role,
        newRole: role,
      },
    });
    const [updated] = await tx
      .update(organizationMemberships)
      .set({ role })
      .where(and(
        eq(organizationMemberships.organizationId, grant.context.organizationId),
        eq(organizationMemberships.userId, userId),
      ))
      .returning({ userId: organizationMemberships.userId, role: organizationMemberships.role });
    return { member: updated };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}

export const PATCH = withApiGuard(handlePATCH);
