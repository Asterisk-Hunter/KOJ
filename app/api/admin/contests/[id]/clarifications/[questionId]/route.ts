import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { contestClarifications } from "@/db/schema";
import { ensureUserRow, jsonError, requireContestManager } from "@/app/api/admin/authz";
import { MAX_CONTEST_REGISTRATION_BODY_BYTES, readBoundedJsonObject } from "@/app/api/body-guard";
import { recordAdminAuditEvent } from "@/app/api/admin/audit-logs/writer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; questionId: string }> }) {
  const grant = await requireContestManager();
  if (!grant.ok) return grant.response;
  const { id: idRaw, questionId: questionRaw } = await ctx.params;
  const contestId = Number(idRaw);
  const questionId = Number(questionRaw);
  if (!Number.isInteger(contestId) || contestId <= 0 || !Number.isInteger(questionId) || questionId <= 0) return jsonError("invalid id", 400);
  const parsed = await readBoundedJsonObject(req, MAX_CONTEST_REGISTRATION_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const answer = parsed.value.answer;
  const visibility = parsed.value.visibility ?? "private";
  if (typeof answer !== "string" || !answer.trim() || answer.trim().length > 2000) return jsonError("answer must be 1..2000 characters", 400);
  if (visibility !== "private" && visibility !== "public") return jsonError("visibility must be private or public", 400);
  if (!await ensureUserRow(grant.userId)) return jsonError("failed to resolve staff account", 500);
  const updated = await db.transaction(async (tx) => {
    const rows = await tx.update(contestClarifications).set({ answer: answer.trim(), visibility, answeredBy: grant.userId, answeredAt: new Date() })
      .where(and(eq(contestClarifications.id, questionId), eq(contestClarifications.contestId, contestId)))
      .returning({ id: contestClarifications.id });
    if (rows.length > 0) {
      await recordAdminAuditEvent(tx, {
        actorId: grant.userId,
        action: visibility === "public" ? "contest.clarification_broadcast" : "contest.clarification_answered",
        entityType: "contest_clarification",
        entityId: questionId,
        ...(visibility === "public" ? { metadata: { status: "published" } } : {}),
      });
    }
    return rows;
  });
  if (!updated.length) return jsonError("clarification not found", 404);
  return Response.json({ id: questionId, answered: true });
}
