CREATE TYPE "public"."claim_status" AS ENUM('pending', 'approved', 'rejected', 'granted', 'withdrawn');--> statement-breakpoint
CREATE TABLE "claim_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_id" uuid NOT NULL,
	"project_id" uuid,
	"assistant" boolean DEFAULT false NOT NULL,
	"previous_machine_id" uuid,
	"status" "claim_status" NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_requests_target_ck" CHECK ("claim_requests"."assistant" = ("claim_requests"."project_id" is null))
);
--> statement-breakpoint
CREATE TABLE "machine_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_id" uuid NOT NULL,
	"project_id" uuid,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mcp_servers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machine_skills_scope_uq" UNIQUE NULLS NOT DISTINCT("machine_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "machine_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machine_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "pairing_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"machine_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pairing_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
DROP INDEX "events_target_machine_idx";--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "seq" bigint;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "hardware" jsonb;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "online" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "last_heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "health" jsonb;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "resources" jsonb;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "running_jobs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "cli_version" text;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "app_version" text;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "agent_model" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "agent_effort" "effort";--> statement-breakpoint
ALTER TABLE "claim_requests" ADD CONSTRAINT "claim_requests_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_requests" ADD CONSTRAINT "claim_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_requests" ADD CONSTRAINT "claim_requests_previous_machine_id_machines_id_fk" FOREIGN KEY ("previous_machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_skills" ADD CONSTRAINT "machine_skills_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_skills" ADD CONSTRAINT "machine_skills_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_tokens" ADD CONSTRAINT "machine_tokens_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claim_requests_pending_project_uq" ON "claim_requests" USING btree ("machine_id","project_id") WHERE "claim_requests"."status" = 'pending' and "claim_requests"."project_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "claim_requests_pending_assistant_uq" ON "claim_requests" USING btree ("machine_id") WHERE "claim_requests"."status" = 'pending' and "claim_requests"."assistant";--> statement-breakpoint
CREATE INDEX "claim_requests_status_idx" ON "claim_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "machine_tokens_machine_idx" ON "machine_tokens" USING btree ("machine_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_seq_uq" ON "events" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "events_target_seq_idx" ON "events" USING btree ("target_machine_id","seq");--> statement-breakpoint
-- Delivery sequence in commit order. bigserial ids are handed out at insert, so a transaction that commits
-- later can hold a smaller id than one already read by a stream, and a cursor reader would skip it. The
-- deferred trigger below assigns `seq` at commit time under a transaction-scoped advisory lock, which is
-- held until the commit is visible: whoever sees seq n has seen every committed event below n.
CREATE SEQUENCE "events_seq_seq" AS bigint OWNED BY "events"."seq";--> statement-breakpoint
UPDATE "events" SET "seq" = "id";--> statement-breakpoint
SELECT setval('events_seq_seq', COALESCE((SELECT max("seq") FROM "events"), 0) + 1, false);--> statement-breakpoint
CREATE FUNCTION "events_assign_seq"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('crew.events.seq', 0));
  UPDATE "events" SET "seq" = nextval('events_seq_seq') WHERE "id" = NEW."id";
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "events_assign_seq" AFTER INSERT ON "events"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "events_assign_seq"();
