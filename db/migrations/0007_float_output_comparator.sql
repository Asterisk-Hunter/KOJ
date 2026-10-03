ALTER TABLE "problems"
  ADD COLUMN IF NOT EXISTS "output_comparator" text NOT NULL DEFAULT 'exact',
  ADD COLUMN IF NOT EXISTS "absolute_tolerance" double precision NOT NULL DEFAULT 0.000001,
  ADD COLUMN IF NOT EXISTS "relative_tolerance" double precision NOT NULL DEFAULT 0.000001;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'problems_output_comparator_check'
      AND conrelid = 'public.problems'::regclass
  ) THEN
    ALTER TABLE "problems"
      ADD CONSTRAINT "problems_output_comparator_check"
      CHECK ("output_comparator" IN ('exact', 'float'));
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'problems_absolute_tolerance_check'
      AND conrelid = 'public.problems'::regclass
  ) THEN
    ALTER TABLE "problems"
      ADD CONSTRAINT "problems_absolute_tolerance_check"
      CHECK ("absolute_tolerance" BETWEEN 0 AND 1);
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'problems_relative_tolerance_check'
      AND conrelid = 'public.problems'::regclass
  ) THEN
    ALTER TABLE "problems"
      ADD CONSTRAINT "problems_relative_tolerance_check"
      CHECK ("relative_tolerance" BETWEEN 0 AND 1);
  END IF;
END $$;
