CREATE TYPE "public"."agent_role" AS ENUM('assistant', 'pm', 'dev', 'qc');--> statement-breakpoint
CREATE TYPE "public"."budget_hold" AS ENUM('children', 'cost');--> statement-breakpoint
CREATE TYPE "public"."comment_author_kind" AS ENUM('owner', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."complexity" AS ENUM('trivial', 'small', 'medium', 'large');--> statement-breakpoint
CREATE TYPE "public"."docs_status" AS ENUM('unknown', 'missing', 'initializing', 'ready');--> statement-breakpoint
CREATE TYPE "public"."effort" AS ENUM('low', 'medium', 'high', 'xhigh', 'max');--> statement-breakpoint
CREATE TYPE "public"."model_alias" AS ENUM('haiku', 'sonnet', 'opus', 'fable');--> statement-breakpoint
CREATE TYPE "public"."project_platform" AS ENUM('web', 'mobile', 'web_mobile', 'backend');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('todo', 'triage', 'needs_input', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ticket_type" AS ENUM('request', 'pm_task', 'dev', 'qc', 'bug', 'docs_init');--> statement-breakpoint
CREATE TABLE "budgets_usage" (
	"project_id" uuid NOT NULL,
	"day" date NOT NULL,
	"cost_usd" numeric(14, 6) DEFAULT 0 NOT NULL,
	CONSTRAINT "budgets_usage_project_id_day_pk" PRIMARY KEY("project_id","day")
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_kind" "comment_author_kind" NOT NULL,
	"author_role" "agent_role",
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"ticket_id" uuid,
	"project_id" uuid,
	"target_machine_id" uuid,
	"target_role" "agent_role",
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text NOT NULL,
	"machine_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"status_code" integer NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_machine_id_key_pk" PRIMARY KEY("machine_id","key")
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"hostname" text,
	"os" text,
	"hosts_assistant" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret" text NOT NULL,
	"totp_last_step" integer,
	"recovery_code_hashes" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"repo_url" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"owner_machine_id" uuid,
	"docs_status" "docs_status" DEFAULT 'unknown' NOT NULL,
	"platform" "project_platform" NOT NULL,
	"ui_test_mcp" jsonb DEFAULT '{"maestro":"maestro","playwright":"playwright"}'::jsonb NOT NULL,
	"max_children_per_ticket" integer DEFAULT 12 NOT NULL,
	"ticket_tree_budget_usd" numeric(14, 6),
	"daily_budget_usd" numeric(14, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_counters" (
	"scope" text PRIMARY KEY NOT NULL,
	"next" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"is_current" boolean NOT NULL,
	"summary_md" text NOT NULL,
	"files_changed" text[] DEFAULT '{}'::text[] NOT NULL,
	"commits" text[] DEFAULT '{}'::text[] NOT NULL,
	"head_sha" text,
	"skills_selected" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mcps_selected" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mcps_used" text[] DEFAULT '{}'::text[] NOT NULL,
	"mcps_missing" text[] DEFAULT '{}'::text[] NOT NULL,
	"skills_used" text[] DEFAULT '{}'::text[] NOT NULL,
	"skills_missing" text[] DEFAULT '{}'::text[] NOT NULL,
	"docs_first" boolean NOT NULL,
	"tests_run" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bugs_filed" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"left_resources" boolean DEFAULT false NOT NULL,
	"cost_usd" numeric(14, 6) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"type" "ticket_type" NOT NULL,
	"parent_id" uuid,
	"project_id" uuid,
	"project_hint_id" uuid,
	"assignee_role" "agent_role" NOT NULL,
	"assignee_machine_id" uuid,
	"status" "ticket_status" DEFAULT 'todo' NOT NULL,
	"priority" "ticket_priority" DEFAULT 'medium' NOT NULL,
	"allow_config_change" boolean DEFAULT false NOT NULL,
	"complexity" "complexity",
	"model" "model_alias",
	"effort" "effort",
	"required_skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"required_mcps" text[] DEFAULT '{}'::text[] NOT NULL,
	"depends_on" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"pairs_with" uuid,
	"origin_dev_id" uuid,
	"bug_cycle" integer DEFAULT 0 NOT NULL,
	"flows" text[] DEFAULT '{}'::text[] NOT NULL,
	"agent_session_id" text,
	"cost_usd" numeric(14, 6) DEFAULT 0 NOT NULL,
	"budget_hold" "budget_hold",
	"child_cap_lifted" boolean DEFAULT false NOT NULL,
	"cost_budget_lifted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "budgets_usage" ADD CONSTRAINT "budgets_usage_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_machine_id_machines_id_fk" FOREIGN KEY ("owner_machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_owner_id_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_reports" ADD CONSTRAINT "ticket_reports_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_parent_id_tickets_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_project_hint_id_projects_id_fk" FOREIGN KEY ("project_hint_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_machine_id_machines_id_fk" FOREIGN KEY ("assignee_machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_pairs_with_tickets_id_fk" FOREIGN KEY ("pairs_with") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_origin_dev_id_tickets_id_fk" FOREIGN KEY ("origin_dev_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_ticket_idx" ON "comments" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "events_target_machine_idx" ON "events" USING btree ("target_machine_id","id");--> statement-breakpoint
CREATE INDEX "events_ticket_idx" ON "events" USING btree ("ticket_id","id");--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "machines_single_assistant_host" ON "machines" USING btree ("hosts_assistant") WHERE "machines"."hosts_assistant";--> statement-breakpoint
CREATE INDEX "sessions_owner_idx" ON "sessions" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_reports_version_uq" ON "ticket_reports" USING btree ("ticket_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_reports_current_uq" ON "ticket_reports" USING btree ("ticket_id") WHERE "ticket_reports"."is_current";--> statement-breakpoint
CREATE INDEX "tickets_parent_idx" ON "tickets" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "tickets_project_status_idx" ON "tickets" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "tickets_assignee_machine_idx" ON "tickets" USING btree ("assignee_machine_id");--> statement-breakpoint
CREATE INDEX "tickets_updated_idx" ON "tickets" USING btree ("updated_at","id");--> statement-breakpoint
CREATE INDEX "tickets_depends_on_idx" ON "tickets" USING gin ("depends_on");--> statement-breakpoint
CREATE INDEX "tickets_flows_idx" ON "tickets" USING gin ("flows");