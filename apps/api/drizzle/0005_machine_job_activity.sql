ALTER TABLE "machines" ADD COLUMN "waiting_jobs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "failed_jobs" jsonb DEFAULT '[]'::jsonb NOT NULL;