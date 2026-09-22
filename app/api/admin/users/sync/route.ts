import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { jsonError, requireAdmin } from "@/app/api/admin/authz";
import { handleUserDeleted } from "@/app/api/webhooks/clerk/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin: reconcile Neon rows against the Clerk directory. Rows whose Clerk
 * user is gone are purged when FK-free, else anonymized (standings/history
 * preserved) — same outcome as the `user.deleted` webhook, for events it
 * missed. Never creates rows: signups sync lazily on first activity.
 */
export async function POST() {
  const grant = await requireAdmin();
  if (!grant.ok) return grant.response;

  let client: Awaited<ReturnType<typeof clerkClient>>;
  try {
    client = await clerkClient();
  } catch {
    return jsonError("could not reach Clerk directory", 502);
  }

  const clerkIds = new Set<string>();
  try {
    let offset = 0;
    for (;;) {
      const page = await client.users.getUserList({ limit: 200, offset, orderBy: "-created_at" });
      for (const u of page.data) clerkIds.add(u.id);
      if (page.data.length < 200 || offset > 5000) break;
      offset += 200;
    }
  } catch {
    return jsonError("could not reach Clerk directory", 502);
  }

  const neonRows = await db.select({ clerkId: users.clerkId }).from(users);
  let removed = 0;
  let anonymized = 0;
  for (const r of neonRows) {
    if (clerkIds.has(r.clerkId)) continue;
    const outcome = await handleUserDeleted(r.clerkId);
    if (outcome === "deleted") removed++;
    else anonymized++;
  }

  return NextResponse.json({ checked: neonRows.length, removed, anonymized });
}
