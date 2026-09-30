CREATE TABLE "runtime_bundles" (
	"version" text PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime_releases" (
	"version" text PRIMARY KEY NOT NULL,
	"manifest" text NOT NULL,
	"signature" text NOT NULL,
	"key_id" text NOT NULL,
	"commit" text NOT NULL,
	"shell_range" jsonb NOT NULL,
	"bundle_sha256" text NOT NULL,
	"size" integer NOT NULL,
	"source" text NOT NULL,
	"published_by" text NOT NULL,
	"built_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "runtime_state" jsonb;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "runtime_pinned_version" text;--> statement-breakpoint
ALTER TABLE "runtime_bundles" ADD CONSTRAINT "runtime_bundles_version_runtime_releases_version_fk" FOREIGN KEY ("version") REFERENCES "public"."runtime_releases"("version") ON DELETE cascade ON UPDATE no action;