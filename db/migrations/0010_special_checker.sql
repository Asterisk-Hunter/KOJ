ALTER TABLE "problems"
  ADD COLUMN IF NOT EXISTS "checker_code" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'problems_checker_code_size_check'
      AND conrelid = 'public.problems'::regclass
  ) THEN
    ALTER TABLE "problems"
      ADD CONSTRAINT "problems_checker_code_size_check"
      CHECK ("checker_code" IS NULL OR octet_length("checker_code") <= 65536);
  END IF;
END $$;
