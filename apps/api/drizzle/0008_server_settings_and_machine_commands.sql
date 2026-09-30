CREATE TYPE "public"."machine_command_status" AS ENUM('pending', 'running', 'done', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."settings_kind" AS ENUM('prompt', 'policy', 'models', 'budgets', 'resources', 'project_mcp', 'project_folders');--> statement-breakpoint
CREATE TYPE "public"."settings_scope" AS ENUM('global', 'machine', 'project');--> statement-breakpoint
CREATE TABLE "machine_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_id" uuid NOT NULL,
	"action" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "machine_command_status" DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error" text,
	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "settings_kind" NOT NULL,
	"scope" "settings_scope" NOT NULL,
	"machine_id" uuid,
	"project_id" uuid,
	"name" text DEFAULT '' NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb,
	"note" text DEFAULT '' NOT NULL,
	"author" text NOT NULL,
	"restored_from" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_revisions_version_uq" UNIQUE NULLS NOT DISTINCT("kind","scope","machine_id","project_id","name","version"),
	CONSTRAINT "settings_revisions_scope_ck" CHECK (("settings_revisions"."scope" = 'global' and "settings_revisions"."machine_id" is null and "settings_revisions"."project_id" is null)
        or ("settings_revisions"."scope" = 'machine' and "settings_revisions"."machine_id" is not null and "settings_revisions"."project_id" is null)
        or ("settings_revisions"."scope" = 'project' and "settings_revisions"."project_id" is not null and "settings_revisions"."machine_id" is null))
);
--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "settings_state" jsonb;--> statement-breakpoint
ALTER TABLE "machine_commands" ADD CONSTRAINT "machine_commands_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings_revisions" ADD CONSTRAINT "settings_revisions_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings_revisions" ADD CONSTRAINT "settings_revisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "machine_commands_machine_idx" ON "machine_commands" USING btree ("machine_id","created_at");