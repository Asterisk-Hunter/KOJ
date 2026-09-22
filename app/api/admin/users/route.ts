import { NextRequest, NextResponse } from "next/server";
import { desc, eq, ilike, inArray, or } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { jsonError, requireAdmin } from "@/app/api/admin/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role = "contestant" | "setter" | "admin";

function parseRole(v: unknown): Role | null {
  if (v === "contestant" || v === "setter" || v === "admin") return v;
  return null;
}

type ClerkDirUser = {
  id: string;
  username?: string | null;
  firstName?: string | null;
  primaryEmailAddressId?: string | null;
  emailAddresses?: Array<{ id: string; emailAddress: string }>;
  createdAt?: number;
};

function dirEmail(u: ClerkDirUser): string {
  const list = u.emailAddresses ?? [];
  return (
    list.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
    list[0]?.emailAddress ??
    ""
  );
}

function dirName(u: ClerkDirUser): string {
  const email = dirEmail(u);
  return u.username ?? u.firstName ?? (email ? email.split("@")[0] : u.id);
}

/**
 * Admin: list users newest-first. Clerk is the source of truth for signups
 * (a Neon row only exists after first activity), so the directory is read
 * from Clerk and enriched with Neon role/suspended. `role` defaults to
 * `contestant` and `synced` is false until the row exists.
 */
export async function GET(req: NextRequest) {
  const grant = await requireAdmin();
  if (!grant.ok) return grant.response;

  const q = req.nextUrl.searchParams.get("q")?.trim() || null;
  const roleRaw = req.nextUrl.searchParams.get("role");
  const limitRaw = req.nextUrl.searchParams.get("limit");

  let limit = 50;
  if (limitRaw !== null) {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n <= 0 || n > 200) {
      return jsonError("limit must be an integer 1..200", 400);
    }
    limit = n;
  }

  let role: Role | null = null;
  if (roleRaw !== null) {
    role = parseRole(roleRaw);
    if (!role) return jsonError("role must be contestant, setter, or admin", 400);
  }

  // Clerk is the source of truth for signups; Neon holds roles/suspension.
  // If Clerk is unreachable the page falls back to synced Neon rows only,
  // flagged via `source`, so the list never goes blank.
  let dir: { data: ClerkDirUser[]; totalCount: number } | null = null;
  try {
    const client = await clerkClient();
    const res = await client.users.getUserList({
      limit,
      ...(q ? { query: q } : {}),
      orderBy: "-created_at",
    });
    dir = { data: res.data as ClerkDirUser[], totalCount: res.totalCount };
  } catch {
    dir = null;
  }

  if (!dir) {
    const conditions = [];
    if (q) {
      const pattern = `%${q.replace(/[%_]/g, "")}%`;
      conditions.push(or(ilike(users.username, pattern), ilike(users.email, pattern)));
    }
    if (role) conditions.push(eq(users.role, role));
    const rows =
      conditions.length > 0
        ? await db
            .select()
            .from(users)
            .where(conditions.length === 1 ? conditions[0] : or(...conditions))
            .orderBy(desc(users.createdAt))
            .limit(limit)
        : await db.select().from(users).orderBy(desc(users.createdAt)).limit(limit);
    return NextResponse.json({
      users: rows.map((u) => ({
        clerkId: u.clerkId,
        username: u.username,
        email: u.email,
        role: u.role,
        suspended: u.suspended,
        synced: true,
        createdAt: u.createdAt.toISOString(),
      })),
      total: rows.length,
      source: "neon",
    });
  }

  const list = dir;

  const clerkIds = list.data.map((u) => u.id);
  const neonRows =
    clerkIds.length > 0
      ? await db.select().from(users).where(inArray(users.clerkId, clerkIds))
      : [];
  const neonById = new Map(neonRows.map((r) => [r.clerkId, r]));

  let merged = list.data.map((u) => {
    const neon = neonById.get(u.id);
    const email = dirEmail(u);
    return {
      clerkId: u.id,
      username: dirName(u),
      email,
      role: neon?.role ?? "contestant",
      suspended: neon?.suspended ?? false,
      synced: neon !== undefined,
      createdAt:
        typeof u.createdAt === "number"
          ? new Date(u.createdAt).toISOString()
          : new Date(0).toISOString(),
    };
  });
  if (role) merged = merged.filter((m) => m.role === role);

  return NextResponse.json({ users: merged, total: list.totalCount, source: "clerk" });
}

/**
 * Admin: change a user's role (REQ-AUTH-04 / BR-03) and/or suspended flag.
 * Refuses self-changes so an admin cannot lock themselves out.
 */
export async function PATCH(req: NextRequest) {
  const grant = await requireAdmin();
  if (!grant.ok) return grant.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid json", 400);
  }
  const b = body as Record<string, unknown>;

  const clerkId = b.clerkId;
  if (typeof clerkId !== "string" || clerkId.length === 0) {
    return jsonError("clerkId is required", 400);
  }
  if (clerkId === grant.userId) {
    return jsonError("cannot change your own record", 400);
  }

  const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (b.role !== undefined) {
    const role = parseRole(b.role);
    if (!role) {
      return jsonError("role must be contestant, setter, or admin", 400);
    }
    patch.role = role;
  }
  if (b.suspended !== undefined) {
    if (typeof b.suspended !== "boolean") {
      return jsonError("suspended must be a boolean", 400);
    }
    patch.suspended = b.suspended;
  }
  if (patch.role === undefined && patch.suspended === undefined) {
    return jsonError("role or suspended is required", 400);
  }

  // Backfill from Clerk so admin actions work even before first user activity.
  const existing = await db
    .select({ clerkId: users.clerkId })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  if (existing.length === 0) {
    let cu: ClerkDirUser | null = null;
    try {
      cu = (await (await clerkClient()).users.getUser(clerkId)) as ClerkDirUser;
    } catch {
      return jsonError("user not found", 404);
    }
    const email = dirEmail(cu);
    await db
      .insert(users)
      .values({
        clerkId,
        username: dirName(cu),
        email: email || `${clerkId}@placeholder.local`,
        role: "contestant",
        suspended: false,
      })
      .onConflictDoNothing();
  }

  const updated = await db
    .update(users)
    .set(patch)
    .where(eq(users.clerkId, clerkId))
    .returning({
      clerkId: users.clerkId,
      username: users.username,
      role: users.role,
      suspended: users.suspended,
    });
  if (updated.length === 0) return jsonError("user not found", 404);

  return NextResponse.json({ user: updated[0] });
}
