import { NextRequest, NextResponse } from "next/server";
import { desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { jsonError, requireAdmin } from "@/app/api/admin/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role = "contestant" | "problem_setter" | "admin";

function parseRole(v: unknown): Role | null {
  if (v === "contestant" || v === "problem_setter" || v === "admin") return v;
  return null;
}

/** Admin: list users (newest first). Supports `?q=` (username/email search), `?role=`, `?limit=`. */
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
    if (!role) return jsonError("role must be contestant, problem_setter, or admin", 400);
  }

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
      createdAt: u.createdAt.toISOString(),
    })),
  });
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
      return jsonError("role must be contestant, problem_setter, or admin", 400);
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
