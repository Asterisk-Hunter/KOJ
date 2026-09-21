-- Gate 2 note: statements 1 and 3 are pre-existing schema drift (already in
-- schema.ts, never migrated). They fail if already applied; safe to skip those
-- lines on retry. Statement 4 requires the email-dupe precheck (see docs/deployment.md).
ALTER TYPE "public"."submission_status" ADD VALUE 'presentation_error';--> statement-breakpoint
ALTER TABLE "problems" ALTER COLUMN "time_limit_ms" SET DEFAULT 2000;--> statement-breakpoint
ALTER TABLE "contests" ADD COLUMN "invite_code" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");