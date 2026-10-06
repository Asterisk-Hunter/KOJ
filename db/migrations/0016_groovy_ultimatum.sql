CREATE TABLE "research_datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"version" text NOT NULL,
	"source_url" text NOT NULL,
	"license_id" text NOT NULL,
	"license_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
--> statement-breakpoint
CREATE TABLE "research_problems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_id" uuid NOT NULL REFERENCES "research_datasets"("id") ON DELETE CASCADE,
	"source_problem_id" text NOT NULL,
	"split" text NOT NULL,
	"prompt" text NOT NULL,
	"test_cases" jsonb NOT NULL,
	"time_limit_ms" integer DEFAULT 2000 NOT NULL,
	"memory_limit_mb" integer DEFAULT 256 NOT NULL,
	"content_sha256" text NOT NULL,
	CONSTRAINT "research_problems_split_check" CHECK ("split" IN ('train', 'heldout', 'external')),
	CONSTRAINT "research_problems_limits_check" CHECK ("time_limit_ms" BETWEEN 100 AND 10000 AND "memory_limit_mb" BETWEEN 64 AND 512),
	CONSTRAINT "research_problems_tests_array_check" CHECK (jsonb_typeof("test_cases") = 'array' AND jsonb_array_length("test_cases") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "research_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_id" uuid NOT NULL REFERENCES "research_datasets"("id"),
	"split" text NOT NULL,
	"model_id" text NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"idempotency_key_hash" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"total_samples" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_runs_idempotency_key_hash_unique" UNIQUE("idempotency_key_hash"),
	CONSTRAINT "research_runs_split_check" CHECK ("split" IN ('train', 'heldout', 'external')),
	CONSTRAINT "research_runs_round_check" CHECK ("round" >= 0),
	CONSTRAINT "research_runs_sample_count_check" CHECK ("total_samples" BETWEEN 1 AND 64)
);
--> statement-breakpoint
CREATE TABLE "research_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"split" text NOT NULL,
	"problem_id" uuid NOT NULL,
	"sample_id" text NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"verdict" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"leased_by" text,
	"lease_expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_samples_status_check" CHECK ("status" IN ('queued', 'leased', 'completed', 'dead')),
	CONSTRAINT "research_samples_verdict_check" CHECK ("verdict" IS NULL OR "verdict" IN ('accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded', 'runtime_error', 'compilation_error', 'presentation_error')),
	CONSTRAINT "research_samples_lease_check" CHECK ("status" <> 'leased' OR ("leased_by" IS NOT NULL AND "lease_expires_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "research_datasets_slug_version_unique" ON "research_datasets" USING btree ("slug", "version");
--> statement-breakpoint
CREATE UNIQUE INDEX "research_problems_dataset_source_unique" ON "research_problems" USING btree ("dataset_id", "source_problem_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "research_problems_id_dataset_split_unique" ON "research_problems" USING btree ("id", "dataset_id", "split");
--> statement-breakpoint
CREATE UNIQUE INDEX "research_runs_id_dataset_split_unique" ON "research_runs" USING btree ("id", "dataset_id", "split");
--> statement-breakpoint
CREATE UNIQUE INDEX "research_samples_run_sample_unique" ON "research_samples" USING btree ("run_id", "sample_id");
--> statement-breakpoint
ALTER TABLE "research_samples" ADD CONSTRAINT "research_samples_run_id_dataset_id_split_research_runs_id_dataset_id_split_fk" FOREIGN KEY ("run_id", "dataset_id", "split") REFERENCES "research_runs"("id", "dataset_id", "split");
--> statement-breakpoint
ALTER TABLE "research_samples" ADD CONSTRAINT "research_samples_problem_id_dataset_id_split_research_problems_id_dataset_id_split_fk" FOREIGN KEY ("problem_id", "dataset_id", "split") REFERENCES "research_problems"("id", "dataset_id", "split");
--> statement-breakpoint
CREATE INDEX "research_problems_dataset_split_idx" ON "research_problems" USING btree ("dataset_id", "split", "id");
--> statement-breakpoint
CREATE INDEX "research_samples_queue_idx" ON "research_samples" USING btree ("available_at", "created_at") WHERE "status" = 'queued';
--> statement-breakpoint
CREATE INDEX "research_samples_run_status_idx" ON "research_samples" USING btree ("run_id", "status");
