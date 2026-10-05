import "server-only";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { organizationMemberships, organizations, users } from "@/db/schema";
import type { OrganizationRole } from "./organization-policy";

export const ORGANIZATION_COOKIE = "koj_organization";
export const ORGANIZATION_HEADER = "x-koj-organization";
export const DEFAULT_ORGANIZATION_SLUG = "koj";

export type OrganizationContext = {
  organizationId: number;
  slug: string;
  name: string;
  isPublic: boolean;
  role: OrganizationRole | null;
  isMember: boolean;
  suspended: boolean;
};

export async function resolveOrganizationContext(
  userId: string | null,
  requestedSlug?: string | null,
): Promise<OrganizationContext | null> {
  let selectedSlug = requestedSlug?.trim() || null;
  if (!selectedSlug) {
    const requestHeaders = await headers();
    selectedSlug = requestHeaders.get(ORGANIZATION_HEADER)?.trim() || null;
  }
  if (!selectedSlug) {
    const cookieStore = await cookies();
    selectedSlug = cookieStore.get(ORGANIZATION_COOKIE)?.value.trim() || null;
  }
  selectedSlug ??= DEFAULT_ORGANIZATION_SLUG;

  const rows = await db
    .select({
      organizationId: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
      isPublic: organizations.isPublic,
      role: organizationMemberships.role,
      userSuspended: users.suspended,
    })
    .from(organizations)
    .leftJoin(
      organizationMemberships,
      userId
        ? and(
            eq(organizationMemberships.organizationId, organizations.id),
            eq(organizationMemberships.userId, userId),
          )
        : eq(organizationMemberships.organizationId, -1),
    )
    .leftJoin(users, userId ? eq(users.clerkId, userId) : eq(users.clerkId, ""))
    .where(eq(organizations.slug, selectedSlug))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const isMember = row.role !== null;
  if (!row.isPublic && !isMember) return null;

  return {
    organizationId: row.organizationId,
    slug: row.slug,
    name: row.name,
    isPublic: row.isPublic,
    role: row.role,
    isMember,
    suspended: row.userSuspended ?? false,
  };
}

export type OrganizationRoleGrant =
  | { ok: true; context: OrganizationContext; userId: string }
  | { ok: false; response: NextResponse };

export async function requireOrganizationRole(
  roles: readonly OrganizationRole[],
  requestedSlug?: string | null,
): Promise<OrganizationRoleGrant> {
  const session = await auth();
  const userId = session.isAuthenticated ? session.userId : null;
  if (!userId) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const context = await resolveOrganizationContext(userId, requestedSlug);
  if (!context) {
    return { ok: false, response: NextResponse.json({ error: "organization not found" }, { status: 404 }) };
  }
  if (context.suspended || !context.role || !roles.includes(context.role)) {
    return { ok: false, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true, context, userId };
}
