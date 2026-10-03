import { db } from "@/db";
import { adminAuditLogs } from "@/db/schema";
import { sanitizeAuditEventMetadata } from "./metadata";

type AuditScalar = string | number | boolean | null;
type AuditMetadata = Readonly<Record<string, AuditScalar>>;
type AuditWriter = Pick<typeof db, "insert">;

export type AdminAuditEvent = {
  actorId: string;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  metadata?: AuditMetadata;
};

export async function recordAdminAuditEvent(
  writer: AuditWriter,
  event: AdminAuditEvent,
): Promise<void> {
  const metadata = sanitizeAuditEventMetadata(event.metadata);
  await writer.insert(adminAuditLogs).values({
    actorId: event.actorId,
    action: event.action.slice(0, 100),
    entityType: event.entityType.slice(0, 100),
    entityId: event.entityId === null || event.entityId === undefined ? null : String(event.entityId).slice(0, 128),
    metadata,
  });
}
