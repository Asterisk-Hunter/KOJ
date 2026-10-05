import { withApiGuard } from "@/app/api/guard";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireOrganizationAdmin } from "@/app/api/admin/authz";
import { db } from "@/db";
import { adminAuditLogs } from "@/db/schema";
import { sanitizeAuditMetadata } from "./metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUDIT_LOG_LIMIT = 100;
async function handleGET() {
  const grant = await requireOrganizationAdmin();
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
    .where(eq(adminAuditLogs.organizationId, grant.context.organizationId))
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

export const GET = withApiGuard(handleGET);
