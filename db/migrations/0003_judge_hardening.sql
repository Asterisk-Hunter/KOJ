ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "judge_infra_error" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submissions_user_problem_time_idx" ON "submissions" USING btree ("user_id","problem_id","submitted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submissions_contest_user_time_idx" ON "submissions" USING btree ("contest_id","user_id","submitted_at") WHERE contest_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submissions_status_pending_running_idx" ON "submissions" USING btree ("submitted_at") WHERE status IN ('pending', 'running');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submissions_infra_error_idx" ON "submissions" USING btree ("submitted_at") WHERE judge_infra_error = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contest_problems_contest_position_idx" ON "contest_problems" USING btree ("contest_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "problem_test_cases_problem_position_idx" ON "problem_test_cases" USING btree ("problem_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_role_idx" ON "users" USING btree ("role");
