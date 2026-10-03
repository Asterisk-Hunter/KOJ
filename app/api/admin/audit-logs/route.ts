import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/admin/authz";
import { db } from "@/db";
import { adminAuditLogs } from "@/db/schema";
import { sanitizeAuditMetadata } from "./metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUDIT_LOG_LIMIT = 100;
export async function GET() {
  const grant = await requireAdmin();
  if (!grant.ok) return grant.response;

  const rows = await db
    .select({
      id: adminAuditLogs.id,
      actorId: adminAuditLogs.actorId,
      action: adminAuditLogs.action,
      entityType: adminAuditLogs.entityType,
      entityId: adminAuditLogs.entityId,
      metadata: adminAuditLogs.metadata,
      createdAt: adminAuditLogs.createdAt,
    })
    .from(adminAuditLogs)
    .orderBy(desc(adminAuditLogs.createdAt))
    .limit(AUDIT_LOG_LIMIT);

  return NextResponse.json({
    auditLogs: rows.map((row) => ({
      id: row.id,
      actorId: row.actorId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      metadata: sanitizeAuditMetadata(row.metadata),
      createdAt: row.createdAt.toISOString(),
    })),
    limit: AUDIT_LOG_LIMIT,
  });
}
