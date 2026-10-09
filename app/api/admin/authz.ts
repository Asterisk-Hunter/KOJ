import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { decideStaffAccess, type AccessRole, type StaffAccess } from "./access-policy";
import { requireOrganizationRole, type OrganizationContext } from "@/lib/organizations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export type AdminGrant = { ok: true; userId: string } | { ok: false; response: NextResponse };

export type OrganizationStaffGrant =
  | { ok: true; userId: string; context: OrganizationContext }
  | { ok: false; response: NextResponse };

async function checkStaffAccess(
  userId: string,
  access: StaffAccess,
  allowlistedAdmin = false,
): Promise<{ role: AccessRole; response: NextResponse | null }> {
  const rows = await db
    .select({ role: users.role, suspended: users.suspended })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);
  const user = rows[0];
  const decision = decideStaffAccess(
    user?.role ?? null,
    user?.suspended ?? false,
    allowlistedAdmin,
    access,
  );
  const response =
    decision === "suspended"
      ? jsonError("account suspended", 403)
      : decision === "forbidden"
        ? jsonError("forbidden", 403)
        : null;
  return { role: user?.role ?? null, response };
}

/** Admin-only gate: `ADMIN_CLERK_IDS` env allowlist OR `users.role == "admin"` in Neon. */
export async function requireAdmin(): Promise<AdminGrant> {
  const session = await auth();
  const userId = session.isAuthenticated ? session.userId : null;
  if (!userId) return { ok: false, response: jsonError("unauthorized", 401) };

  const allowedAdminIds = (process.env.ADMIN_CLERK_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const result = await checkStaffAccess(userId, "admin", allowedAdminIds.includes(userId));
  return result.response
    ? { ok: false, response: result.response }
    : { ok: true, userId };
}

export type SetterGrant =
  | { ok: true; userId: string; dbRole: string | null; context: OrganizationContext }
  | { ok: false; response: NextResponse };

/**
 * Contest-manager gate: Neon `users.role` of `admin` or `setter`.
 * Merged role (was: separate problem_setter/contest_setter).
 * Problem management stays on requireSetter; user/role management stays on
 * requireAdmin (BR-03).
 */
export async function requireContestManager(): Promise<OrganizationStaffGrant> {
  const grant = await requireOrganizationRole(["admin", "setter"]);
  return grant.ok
    ? { ok: true, userId: grant.userId, context: grant.context }
    : grant;
}

export async function requireOrganizationAdmin(): Promise<OrganizationStaffGrant> {
  const grant = await requireOrganizationRole(["admin"]);
  return grant.ok
    ? { ok: true, userId: grant.userId, context: grant.context }
    : grant;
}

/**
 * Problem-setter gate: Neon `users.role` must hold `admin` or `setter`.
 */
export async function requireSetter(): Promise<SetterGrant> {
  const grant = await requireOrganizationRole(["admin", "setter"]);
  return grant.ok
    ? { ok: true, userId: grant.userId, dbRole: grant.context.role, context: grant.context }
    : grant;
}

export type StaffRole = "admin" | "setter";

export type StaffGrant =
  | { ok: true; userId: string; role: StaffRole; context: OrganizationContext }
  | { ok: false; response: NextResponse };

/**
 * Staff gate: admin or setter (DB role only).
 */
export async function requireStaff(): Promise<StaffGrant> {
  const grant = await requireOrganizationRole(["admin", "setter"]);
  if (!grant.ok) return grant;
  const role = grant.context.role;
  if (role !== "admin" && role !== "setter") return { ok: false, response: jsonError("forbidden", 403) };
  return { ok: true, userId: grant.userId, role, context: grant.context };
}

/**
 * Neon `users.username` is unique, but Clerk display names are not (two
 * "Prajwal"s via Google OAuth). Resolve a collision by suffixing a short id
 * fragment. A user's own row never triggers a rename.
 */
export async function uniqueUsername(base: string, clerkId: string): Promise<string> {
  const clean = base.trim() || clerkId;
  const taken = await db
    .select({ clerkId: users.clerkId })
    .from(users)
    .where(eq(users.username, clean))
    .limit(1);
  if (taken.length === 0 || taken[0].clerkId === clerkId) return clean;
  const suffixed = `${clean}_${clerkId.slice(-6)}`;
  const taken2 = await db
    .select({ clerkId: users.clerkId })
    .from(users)
    .where(eq(users.username, suffixed))
    .limit(1);
  if (taken2.length === 0 || taken2[0].clerkId === clerkId) return suffixed;
  return `${clean}_${clerkId.slice(-12)}`;
}

/**
 * Ensure a `users` row exists for a Clerk user id (lazy-create from Clerk,
 * same shape as the submissions/register routes). Needed because admin
 * mutations write FK references (`created_by`) to `users.clerk_id`.
 */
export async function ensureUserRow(userId: string): Promise<boolean> {
  const existing = await db
    .select({ clerkId: users.clerkId, username: users.username, email: users.email })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);

  try {
    const client = await clerkClient();
    const clerkUser = await client.users.getUser(userId);
    const primaryEmail =
      clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)
        ?.emailAddress ??
      clerkUser.emailAddresses[0]?.emailAddress ??
      "";
    const rawUsername =
      clerkUser.username ??
      clerkUser.firstName ??
      (primaryEmail ? primaryEmail.split("@")[0] : userId);
    const username = await uniqueUsername(rawUsername, userId);
    const email = primaryEmail || `${userId}@placeholder.local`;
    if (!username || !email) return false;

    if (existing.length === 0) {
      await db.insert(users).values({ clerkId: userId, username, email });
      return true;
    }

    if (existing[0].username !== username || existing[0].email !== email) {
      await db
        .update(users)
        .set({ username, email })
        .where(eq(users.clerkId, userId));
    }
    return true;
  } catch {
    return false;
  }
}
