CREATE TYPE "submission_participation" AS ENUM ('official', 'virtual');
--> statement-breakpoint
CREATE TABLE "contest_teams" (
  "id" serial PRIMARY KEY NOT NULL,
  "contest_id" integer NOT NULL REFERENCES "contests"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "join_code_hash" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "contest_teams_contest_idx" ON "contest_teams" ("contest_id");
--> statement-breakpoint
ALTER TABLE "contest_registrations" ADD COLUMN "team_id" integer REFERENCES "contest_teams"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE TABLE "contest_virtual_registrations" (
  "contest_id" integer NOT NULL REFERENCES "contests"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("clerk_id") ON DELETE CASCADE,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "ends_at" timestamptz NOT NULL,
  PRIMARY KEY ("contest_id", "user_id")
);
--> statement-breakpoint
ALTER TABLE "submissions"
  ADD COLUMN "team_id" integer REFERENCES "contest_teams"("id") ON DELETE SET NULL,
  ADD COLUMN "participation" "submission_participation" NOT NULL DEFAULT 'official';
