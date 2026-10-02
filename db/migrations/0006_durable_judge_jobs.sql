DO $$
BEGIN
  CREATE TYPE "public"."submission_mode" AS ENUM ('run', 'submit');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."judge_job_status" AS ENUM ('queued', 'leased', 'completed', 'dead');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "submissions"
  ADD COLUMN IF NOT EXISTS "mode" "public"."submission_mode" NOT NULL DEFAULT 'submit';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "judge_jobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "submission_id" integer NOT NULL,
  "status" "public"."judge_job_status" DEFAULT 'queued' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 3 NOT NULL,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "leased_by" text,
  "lease_expires_at" timestamp with time zone,
  "heartbeat_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "judge_jobs_submission_id_unique" UNIQUE("submission_id"),
  CONSTRAINT "judge_jobs_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "judge_jobs_max_attempts_check" CHECK ("max_attempts" > 0),
  CONSTRAINT "judge_jobs_lease_check" CHECK (
    "status" <> 'leased' OR ("leased_by" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
  ),
  CONSTRAINT "judge_jobs_submission_id_submissions_id_fk"
    FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "judge_jobs_claim_idx"
  ON "judge_jobs" USING btree ("available_at", "created_at")
  WHERE "status" = 'queued';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "judge_jobs_expired_lease_idx"
  ON "judge_jobs" USING btree ("lease_expires_at")
  WHERE "status" = 'leased';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "judge_workers" (
  "id" text PRIMARY KEY NOT NULL,
  "hostname" text NOT NULL,
  "status" text DEFAULT 'idle' NOT NULL,
  "active_job_id" integer,
  "last_job_id" integer,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "stopped_at" timestamp with time zone,
  CONSTRAINT "judge_workers_status_check" CHECK ("status" IN ('idle', 'busy', 'stopping')),
  CONSTRAINT "judge_workers_active_job_id_judge_jobs_id_fk"
    FOREIGN KEY ("active_job_id") REFERENCES "judge_jobs"("id") ON DELETE SET NULL
);
