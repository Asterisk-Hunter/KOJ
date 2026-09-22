-- Merge problem_setter + contest_setter into a single setter role.
-- Applied manually to Neon (no __drizzle_migrations bookkeeping in this repo).
-- Live had zero setter rows at apply time; the CASE keeps it safe regardless.
ALTER TYPE "public"."user_role" RENAME TO "user_role_old";--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('contestant', 'setter', 'admin');--> statement-breakpoint
ALTER TABLE "public"."users" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "public"."users" ALTER COLUMN "role" TYPE "public"."user_role" USING (
  CASE WHEN "role"::text IN ('problem_setter', 'contest_setter')
    THEN 'setter'::"public"."user_role"
    ELSE "role"::text::"public"."user_role"
  END);--> statement-breakpoint
ALTER TABLE "public"."users" ALTER COLUMN "role" SET DEFAULT 'contestant'::"public"."user_role";--> statement-breakpoint
DROP TYPE "public"."user_role_old";
