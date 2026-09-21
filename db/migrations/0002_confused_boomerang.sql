ALTER TYPE "public"."submission_status" ADD VALUE 'presentation_error';--> statement-breakpoint
ALTER TABLE "problems" ALTER COLUMN "time_limit_ms" SET DEFAULT 2000;--> statement-breakpoint
ALTER TABLE "contests" ADD COLUMN "invite_code" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");