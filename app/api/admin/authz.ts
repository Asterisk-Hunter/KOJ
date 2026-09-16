import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function clerkHasOrgRole(role: string): Promise<boolean> {
  try {
    const authObj = await auth();
    const hasFn = (
      authObj as unknown as { has?: (arg: unknown) => Promise<boolean> | boolean }
    ).has;
    if (typeof hasFn !== "function") return false;
    const res = hasFn.call(authObj, { role });
    return res instanceof Promise ? await res : Boolean(res);
  } catch {
    return false;
  }
}

async function clerkIsOrgAdmin(): Promise<boolean> {
  return clerkHasOrgRole("org:admin");
}

export type AdminGrant = { ok: true; userId: string } | { ok: false; response: NextResponse };

/** Admin-only gate: Clerk `org:admin` OR `users.role == "admin"` in Neon. */
export async function requireAdmin(): Promise<AdminGrant> {
  const { userId } = await auth();
  if (!userId) return { ok: false, response: jsonError("unauthorized", 401) };
  if (await clerkIsOrgAdmin()) return { ok: true, userId };
  const rows = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);
  if (rows.length > 0 && rows[0].role === "admin") return { ok: true, userId };
  return { ok: false, response: jsonError("forbidden", 403) };
}

export type SetterGrant =
  | { ok: true; userId: string; dbRole: string | null }
  | { ok: false; response: NextResponse };

/**
 * Contest-manager gate: Clerk `org:admin` (or a custom `org:contest_setter`
 * org role once created in the Clerk dashboard) OR Neon `users.role` of
 * `admin` / `contest_setter`. Problem management stays on requireSetter;
 * user/role management stays on requireAdmin (BR-03).
 */
export async function requireContestManager(): Promise<AdminGrant> {
  const { userId } = await auth();
  if (!userId) return { ok: false, response: jsonError("unauthorized", 401) };
  if (await clerkIsOrgAdmin()) return { ok: true, userId };
  // Best-effort: false until the custom org role exists in the dashboard.
  if (await clerkHasOrgRole("org:contest_setter")) return { ok: true, userId };
  const rows = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);
  if (rows.length > 0 && (rows[0].role === "admin" || rows[0].role === "contest_setter")) {
    return { ok: true, userId };
  }
  return { ok: false, response: jsonError("forbidden", 403) };
}

/**
 * Problem-setter gate: `org:admin` counts as admin; otherwise the Neon
 * `users` row must hold `admin` or `problem_setter`.
 */
export async function requireSetter(): Promise<SetterGrant> {
  const { userId } = await auth();
  if (!userId) return { ok: false, response: jsonError("unauthorized", 401) };
  if (await clerkIsOrgAdmin()) return { ok: true, userId, dbRole: "admin" };
  const rows = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);
  const dbRole = rows.length > 0 ? rows[0].role : null;
  if (dbRole === "admin" || dbRole === "problem_setter") {
    return { ok: true, userId, dbRole };
  }
  return { ok: false, response: jsonError("forbidden", 403) };
}

/**
 * Ensure a `users` row exists for a Clerk user id (lazy-create from Clerk,
 * same shape as the submissions/register routes). Needed because admin
 * mutations write FK references (`created_by`) to `users.clerk_id`.
 */
export async function ensureUserRow(userId: string): Promise<boolean> {
  const existing = await db
    .select({ clerkId: users.clerkId })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);
  if (existing.length > 0) return true;
  try {
    const client = await clerkClient();
    const clerkUser = await client.users.getUser(userId);
    const primaryEmail =
      clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)
        ?.emailAddress ??
      clerkUser.emailAddresses[0]?.emailAddress ??
      "";
    const username =
      clerkUser.username ??
      clerkUser.firstName ??
      (primaryEmail ? primaryEmail.split("@")[0] : userId);
    const email = primaryEmail || `${userId}@placeholder.local`;
    if (!username || !email) return false;
    await db.insert(users).values({ clerkId: userId, username, email });
    return true;
  } catch {
    return false;
  }
}
