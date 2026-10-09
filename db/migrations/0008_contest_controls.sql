CREATE TYPE "scoreboard_freeze_mode" AS ENUM ('automatic', 'frozen', 'unfrozen');
--> statement-breakpoint
CREATE TYPE "clarification_visibility" AS ENUM ('private', 'public');
--> statement-breakpoint
ALTER TABLE "contests"
  ADD COLUMN "scoreboard_freeze_mode" "scoreboard_freeze_mode" NOT NULL DEFAULT 'automatic',
  ADD COLUMN "scoreboard_frozen_at" timestamptz,
  ADD COLUMN "scoreboard_reveal_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "contests"
  ADD CONSTRAINT "contests_scoreboard_reveal_count_check" CHECK ("scoreboard_reveal_count" >= 0),
  ADD CONSTRAINT "contests_scoreboard_freeze_state_check"
    CHECK (("scoreboard_freeze_mode" = 'frozen' AND "scoreboard_frozen_at" IS NOT NULL) OR ("scoreboard_freeze_mode" <> 'frozen' AND "scoreboard_frozen_at" IS NULL));
--> statement-breakpoint
CREATE TABLE "contest_announcements" (
  "id" serial PRIMARY KEY NOT NULL,
  "contest_id" integer NOT NULL REFERENCES "contests"("id") ON DELETE CASCADE,
  "author_id" text NOT NULL REFERENCES "users"("clerk_id"),
  "body" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "contest_announcements_order_idx" ON "contest_announcements" ("contest_id", "created_at");
--> statement-breakpoint
CREATE TABLE "contest_clarifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "contest_id" integer NOT NULL REFERENCES "contests"("id") ON DELETE CASCADE,
  "author_id" text NOT NULL REFERENCES "users"("clerk_id"),
  "question" text NOT NULL,
  "answer" text,
  "visibility" "clarification_visibility" NOT NULL DEFAULT 'private',
  "answered_by" text REFERENCES "users"("clerk_id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "answered_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX "contest_clarifications_order_idx" ON "contest_clarifications" ("contest_id", "created_at");
--> statement-breakpoint
ALTER TABLE "contest_clarifications"
  ADD CONSTRAINT "contest_clarifications_public_answer_check"
  CHECK ("visibility" = 'private' OR "answer" IS NOT NULL);
