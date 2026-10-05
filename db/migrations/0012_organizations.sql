CREATE TABLE IF NOT EXISTS "organizations" (
  "id" serial PRIMARY KEY NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "is_public" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "organizations" ("id", "slug", "name", "is_public")
VALUES (1, 'koj', 'Kottayam Online Judge', true)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
SELECT setval(
  pg_get_serial_sequence('organizations', 'id'),
  GREATEST((SELECT COALESCE(MAX("id"), 1) FROM "organizations"), 1),
  true
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_memberships" (
  "organization_id" integer NOT NULL,
  "user_id" text NOT NULL,
  "role" "user_role" DEFAULT 'contestant' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "organization_memberships_organization_id_user_id_pk" PRIMARY KEY ("organization_id", "user_id"),
  CONSTRAINT "organization_memberships_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "organization_memberships_user_id_users_clerk_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("clerk_id") ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO "organization_memberships" ("organization_id", "user_id", "role")
SELECT 1, "clerk_id", "role" FROM "users"
ON CONFLICT ("organization_id", "user_id") DO NOTHING;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_memberships_user_idx"
  ON "organization_memberships" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN IF NOT EXISTS "organization_id" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "problems" ADD CONSTRAINT "problems_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "problems_id_organization_id_unique"
  ON "problems" USING btree ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "contests" ADD COLUMN IF NOT EXISTS "organization_id" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "contests" ADD CONSTRAINT "contests_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contests_id_organization_id_unique"
  ON "contests" USING btree ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "contest_problems" ADD COLUMN IF NOT EXISTS "organization_id" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "contest_problems" ADD CONSTRAINT "contest_problems_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
--> statement-breakpoint
ALTER TABLE "contest_problems" ADD CONSTRAINT "contest_problems_contest_organization_fk"
  FOREIGN KEY ("contest_id", "organization_id") REFERENCES "contests"("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "contest_problems" ADD CONSTRAINT "contest_problems_problem_organization_fk"
  FOREIGN KEY ("problem_id", "organization_id") REFERENCES "problems"("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "organization_id" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_problem_organization_fk"
  FOREIGN KEY ("problem_id", "organization_id") REFERENCES "problems"("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_contest_organization_fk"
  FOREIGN KEY ("contest_id", "organization_id") REFERENCES "contests"("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD COLUMN IF NOT EXISTS "organization_id" integer DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_logs_organization_created_at_idx"
  ON "admin_audit_logs" USING btree ("organization_id", "created_at");
