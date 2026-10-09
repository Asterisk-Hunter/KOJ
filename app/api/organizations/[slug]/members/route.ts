import { withApiGuard } from "@/app/api/guard";
import { and, asc, count, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { organizationMemberships, organizations, users } from "@/db/schema";
import { recordAdminAuditEvent } from "@/app/api/admin/audit-logs/writer";
import { MAX_ADMIN_USER_BODY_BYTES, readBoundedJsonObject } from "@/app/api/body-guard";
import { isOrganizationRole } from "@/lib/organization-policy";
import { requireOrganizationRole } from "@/lib/organizations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(_request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const grant = await requireOrganizationRole(["admin"], slug);
  if (!grant.ok) return grant.response;

  const members = await db
    .select({
      userId: organizationMemberships.userId,
      username: users.username,
      role: organizationMemberships.role,
      createdAt: organizationMemberships.createdAt,
    })
    .from(organizationMemberships)
    .innerJoin(users, eq(organizationMemberships.userId, users.clerkId))
    .where(eq(organizationMemberships.organizationId, grant.context.organizationId))
    .orderBy(asc(users.username))
    .limit(500);
  return NextResponse.json({ members });
}

async function handlePOST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const grant = await requireOrganizationRole(["admin"], slug);
  if (!grant.ok) return grant.response;

  const parsed = await readBoundedJsonObject(request, MAX_ADMIN_USER_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const { userId, role } = parsed.value;
  if (typeof userId !== "string" || userId.length < 1 || userId.length > 255 || !isOrganizationRole(role)) {
    return NextResponse.json({ error: "userId and a valid role are required" }, { status: 400 });
  }
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
      .select({ clerkId: users.clerkId, username: users.username, suspended: users.suspended })
      .from(users)
      .where(eq(users.clerkId, userId))
      .for("update");
    if (!target || target.suspended) return { error: "user not found", status: 404 as const };
    const [existing] = await tx
      .select({ userId: organizationMemberships.userId })
      .from(organizationMemberships)
      .where(and(
        eq(organizationMemberships.organizationId, grant.context.organizationId),
        eq(organizationMemberships.userId, userId),
      ))
      .limit(1);
    if (existing) return { error: "user is already a member", status: 409 as const };
    const [memberCount] = await tx
      .select({ value: count() })
      .from(organizationMemberships)
      .where(eq(organizationMemberships.userId, userId));
    if (memberCount.value >= 10) return { error: "organization membership limit reached", status: 409 as const };

    const rows = await tx
      .insert(organizationMemberships)
      .values({ organizationId: grant.context.organizationId, userId, role })
      .onConflictDoNothing()
      .returning({ userId: organizationMemberships.userId, role: organizationMemberships.role });
    if (rows[0]) {
      await recordAdminAuditEvent(tx, {
        organizationId: grant.context.organizationId,
        actorId: grant.userId,
        action: "organization.member_add",
        entityType: "organization_membership",
        entityId: userId,
        metadata: { organizationId: grant.context.organizationId, userId, role },
      });
    }
    return rows[0]
      ? { member: { ...rows[0], username: target.username } }
      : { error: "user is already a member", status: 409 as const };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result, { status: 201 });
}

export const GET = withApiGuard(handleGET);
export const POST = withApiGuard(handlePOST);
