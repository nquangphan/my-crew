CREATE TYPE "public"."docs_page_kind" AS ENUM('index', 'architecture', 'flow', 'files', 'agents', 'other');--> statement-breakpoint
CREATE TABLE "docs_files" (
	"project_id" uuid NOT NULL,
	"path" text NOT NULL,
	"title" text NOT NULL,
	"kind" "docs_page_kind" NOT NULL,
	"flow_id" text,
	"content" text NOT NULL,
	CONSTRAINT "docs_files_project_id_path_pk" PRIMARY KEY("project_id","path")
);
--> statement-breakpoint
CREATE TABLE "docs_snapshots" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"commit_sha" text NOT NULL,
	"branch" text NOT NULL,
	"machine_id" uuid,
	"manifest" jsonb NOT NULL,
	"total_bytes" integer NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docs_files" ADD CONSTRAINT "docs_files_project_id_docs_snapshots_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."docs_snapshots"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs_snapshots" ADD CONSTRAINT "docs_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs_snapshots" ADD CONSTRAINT "docs_snapshots_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;