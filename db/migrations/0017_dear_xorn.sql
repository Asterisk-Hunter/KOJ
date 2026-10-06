DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "research_datasets") OR EXISTS (SELECT 1 FROM "research_problems") THEN
    RAISE EXCEPTION 'research migration 0017 requires empty research tables; review and migrate existing rows first';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "research_samples" DROP CONSTRAINT "research_samples_run_id_dataset_id_split_research_runs_id_dataset_id_split_fk";
--> statement-breakpoint
ALTER TABLE "research_datasets" ADD COLUMN "organization_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "research_problems" ADD COLUMN "source_url" text NOT NULL;--> statement-breakpoint
ALTER TABLE "research_problems" ADD COLUMN "license_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "research_problems" ADD COLUMN "license_url" text NOT NULL;--> statement-breakpoint
ALTER TABLE "research_datasets" ADD CONSTRAINT "research_datasets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_samples" ADD CONSTRAINT "research_samples_run_id_dataset_id_split_research_runs_id_dataset_id_split_fk" FOREIGN KEY ("run_id","dataset_id","split") REFERENCES "public"."research_runs"("id","dataset_id","split") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "research_datasets_id_organization_unique" ON "research_datasets" USING btree ("id","organization_id");
