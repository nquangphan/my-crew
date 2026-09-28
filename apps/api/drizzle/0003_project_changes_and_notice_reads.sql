CREATE TYPE "public"."project_change_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "notice_reads" (
	"owner_id" uuid NOT NULL,
	"event_seq" bigint NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notice_reads_owner_id_event_seq_pk" PRIMARY KEY("owner_id","event_seq")
);
--> statement-breakpoint
CREATE TABLE "project_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"current_platform" "project_platform" NOT NULL,
	"current_ui_test_mcp" jsonb NOT NULL,
	"platform" "project_platform" NOT NULL,
	"ui_test_mcp" jsonb NOT NULL,
	"status" "project_change_status" DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_owner_id_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_change_requests" ADD CONSTRAINT "project_change_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_change_requests" ADD CONSTRAINT "project_change_requests_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_change_requests_pending_uq" ON "project_change_requests" USING btree ("project_id") WHERE "project_change_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "project_change_requests_status_idx" ON "project_change_requests" USING btree ("status","created_at");