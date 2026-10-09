DO $$
DECLARE
  role_values text[];
BEGIN
  SELECT array_agg(enumlabel::text)
  INTO role_values
  FROM pg_enum
  WHERE enumtypid = 'public.user_role'::regtype;

  IF role_values && ARRAY['problem_setter', 'contest_setter']::text[] THEN
    ALTER TYPE "public"."user_role" RENAME TO "user_role_old";
    CREATE TYPE "public"."user_role" AS ENUM('contestant', 'setter', 'admin');
    ALTER TABLE "public"."users" ALTER COLUMN "role" DROP DEFAULT;
    ALTER TABLE "public"."users" ALTER COLUMN "role" TYPE "public"."user_role" USING (
      CASE WHEN "role"::text IN ('problem_setter', 'contest_setter')
        THEN 'setter'::"public"."user_role"
        ELSE "role"::text::"public"."user_role"
      END);
    ALTER TABLE "public"."users" ALTER COLUMN "role" SET DEFAULT 'contestant'::"public"."user_role";
    DROP TYPE "public"."user_role_old";
  END IF;
END $$;
