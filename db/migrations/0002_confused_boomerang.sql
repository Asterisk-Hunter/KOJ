-- Idempotent schema migration for Neon: safe to re-run in automated CI/CD.
ALTER TYPE "public"."submission_status" ADD VALUE IF NOT EXISTS 'presentation_error';--> statement-breakpoint
ALTER TABLE "problems" ALTER COLUMN "time_limit_ms" SET DEFAULT 2000;--> statement-breakpoint
ALTER TABLE "contests" ADD COLUMN IF NOT EXISTS "invite_code" text;--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_email_unique'
    ) THEN
        ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");
    END IF;
END $$;