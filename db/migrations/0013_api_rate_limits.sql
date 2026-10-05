CREATE TABLE IF NOT EXISTS "api_rate_limits" (
  "key" text PRIMARY KEY NOT NULL,
  "hits" integer NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "api_rate_limits_hits_check" CHECK ("hits" >= 1)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_rate_limits_expires_at_idx"
  ON "api_rate_limits" USING btree ("expires_at");
