import { withApiGuard } from "@/app/api/guard";
import { auth } from "@clerk/nextjs/server";
import { and, asc, count, eq, or } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { organizationMemberships, organizations, users } from "@/db/schema";
import { ensureUserRow } from "@/app/api/admin/authz";
import { recordAdminAuditEvent } from "@/app/api/admin/audit-logs/writer";
import { MAX_ADMIN_USER_BODY_BYTES, readBoundedJsonObject } from "@/app/api/body-guard";
import { isValidOrganizationSlug, organizationSlug } from "@/lib/organization-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function uniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

async function handleGET() {
  const { userId } = await auth();
  const visible = await db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
      isPublic: organizations.isPublic,
      role: organizationMemberships.role,
    })
    .from(organizations)
    .leftJoin(
      organizationMemberships,
      userId ? and(
        eq(organizationMemberships.organizationId, organizations.id),
        eq(organizationMemberships.userId, userId),
      ) : eq(organizationMemberships.organizationId, -1),
    )
    .where(userId ? or(eq(organizations.isPublic, true), eq(organizationMemberships.userId, userId)) : eq(organizations.isPublic, true))
    .orderBy(asc(organizations.name))
    .limit(100);

  return NextResponse.json({
    organizations: visible,
  });
}

async function handlePOST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = await readBoundedJsonObject(request, MAX_ADMIN_USER_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const { name, slug: requestedSlug, isPublic } = parsed.value;
  if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100) {
    return NextResponse.json({ error: "name must be 2 to 100 characters" }, { status: 400 });
  }
  if (isPublic !== undefined && typeof isPublic !== "boolean") {
    return NextResponse.json({ error: "isPublic must be a boolean" }, { status: 400 });
  }
  const slug = typeof requestedSlug === "string" ? requestedSlug.trim().toLowerCase() : organizationSlug(name);
  if (!isValidOrganizationSlug(slug)) {
    return NextResponse.json({ error: "slug must use lowercase letters, numbers, and hyphens" }, { status: 400 });
  }
  if (!(await ensureUserRow(userId))) {
    return NextResponse.json({ error: "failed to resolve user" }, { status: 500 });
  }
  const [actor] = await db
    .select({ suspended: users.suspended })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);
  if (!actor || actor.suspended) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    const result = await db.transaction(async (tx) => {
      const [lockedUser] = await tx
        .select({ clerkId: users.clerkId, suspended: users.suspended })
        .from(users)
        .where(eq(users.clerkId, userId))
        .for("update");
      if (!lockedUser || lockedUser.suspended) return { error: "forbidden", status: 403 as const };
      const [memberCount] = await tx
        .select({ value: count() })
        .from(organizationMemberships)
        .where(eq(organizationMemberships.userId, userId));
      if (memberCount.value >= 10) return { error: "organization membership limit reached", status: 409 as const };

      const [created] = await tx
        .insert(organizations)
        .values({ slug, name: name.trim(), isPublic: isPublic ?? false })
        .returning({ id: organizations.id, slug: organizations.slug, name: organizations.name, isPublic: organizations.isPublic });
      await tx.insert(organizationMemberships).values({
        organizationId: created.id,
        userId,
        role: "admin",
      });
      await recordAdminAuditEvent(tx, {
        organizationId: created.id,
        actorId: userId,
        action: "organization.create",
        entityType: "organization",
        entityId: created.id,
        metadata: { organizationId: created.id },
      });
      return { organization: created };
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ organization: result.organization, role: "admin" }, { status: 201 });
  } catch (error) {
    if (uniqueViolation(error)) return NextResponse.json({ error: "organization slug already exists" }, { status: 409 });
    throw error;
  }
}

export const GET = withApiGuard(handleGET);
export const POST = withApiGuard(handlePOST);
