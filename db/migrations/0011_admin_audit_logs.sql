CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "actor_id" text NOT NULL,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "admin_audit_logs_action_check" CHECK (length("action") BETWEEN 1 AND 100),
  CONSTRAINT "admin_audit_logs_entity_type_check" CHECK (length("entity_type") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_logs_created_at_idx"
  ON "admin_audit_logs" USING btree ("created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_admin_audit_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin audit logs are append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS admin_audit_logs_append_only ON "admin_audit_logs";
--> statement-breakpoint
CREATE TRIGGER admin_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "admin_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION reject_admin_audit_log_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS admin_audit_logs_no_truncate ON "admin_audit_logs";
--> statement-breakpoint
CREATE TRIGGER admin_audit_logs_no_truncate
  BEFORE TRUNCATE ON "admin_audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_admin_audit_log_mutation();
