CREATE INDEX IF NOT EXISTS "contests_status_ends_at_idx" ON "contests" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "problem_test_cases_problem_sample_idx" ON "problem_test_cases" USING btree ("problem_id","is_sample");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submissions_contest_id_idx" ON "submissions" USING btree ("contest_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submissions_user_problem_idx" ON "submissions" USING btree ("user_id","problem_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submissions_user_contest_idx" ON "submissions" USING btree ("user_id","contest_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submissions_status_submitted_at_idx" ON "submissions" USING btree ("status","submitted_at");