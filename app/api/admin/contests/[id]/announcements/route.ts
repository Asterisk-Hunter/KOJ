import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contests, contestAnnouncements } from "@/db/schema";
import { ensureUserRow, jsonError, requireContestManager } from "@/app/api/admin/authz";
import { MAX_CONTEST_REGISTRATION_BODY_BYTES, readBoundedJsonObject } from "@/app/api/body-guard";
import { recordAdminAuditEvent } from "@/app/api/admin/audit-logs/writer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const grant = await requireContestManager();
  if (!grant.ok) return grant.response;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return jsonError("invalid contest id", 400);
  const [contest] = await db.select({ id: contests.id }).from(contests).where(eq(contests.id, id)).limit(1);
  if (!contest) return jsonError("contest not found", 404);
  const parsed = await readBoundedJsonObject(req, MAX_CONTEST_REGISTRATION_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value.body;
  if (typeof body !== "string" || !body.trim() || body.trim().length > 2000) return jsonError("announcement must be 1..2000 characters", 400);
  if (!await ensureUserRow(grant.userId)) return jsonError("failed to resolve staff account", 500);
  const created = await db.transaction(async (tx) => {
    const [announcement] = await tx.insert(contestAnnouncements).values({ contestId: id, authorId: grant.userId, body: body.trim() })
      .returning({ id: contestAnnouncements.id });
    await recordAdminAuditEvent(tx, {
      actorId: grant.userId,
      action: "contest.announcement_created",
      entityType: "contest_announcement",
      entityId: announcement.id,
      metadata: { count: 1 },
    });
    return announcement;
  });
  return NextResponse.json({ id: created.id }, { status: 201 });
}
