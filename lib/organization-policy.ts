import type { userRole } from "@/db/schema";

export type OrganizationRole = (typeof userRole.enumValues)[number];

export function isOrganizationRole(value: unknown): value is OrganizationRole {
  return value === "contestant" || value === "setter" || value === "admin";
}

export function canManageOrganization(role: OrganizationRole | null): boolean {
  return role === "admin";
}

export function canAccessOrganizationResource(
  context: { organizationId: number; isPublic: boolean; isMember: boolean },
  resourceOrganizationId: number,
  access: "read" | "participate",
): boolean {
  if (context.organizationId !== resourceOrganizationId) return false;
  return access === "read" ? context.isPublic || context.isMember : context.isMember;
}

export function canLinkOrganizationResources(firstOrganizationId: number, secondOrganizationId: number): boolean {
  return firstOrganizationId === secondOrganizationId;
}

export function canChangeMembershipRole(
  actorRole: OrganizationRole | null,
  targetRole: OrganizationRole,
  nextRole: OrganizationRole,
  adminCount: number,
): boolean {
  if (!canManageOrganization(actorRole)) return false;
  return targetRole !== "admin" || nextRole === "admin" || adminCount > 1;
}

export function canLeaveOrganization(role: OrganizationRole, adminCount: number): boolean {
  return role !== "admin" || adminCount > 1;
}

export function organizationSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

export function isValidOrganizationSlug(value: string): boolean {
  return value.length >= 2 && value.length <= 48 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
