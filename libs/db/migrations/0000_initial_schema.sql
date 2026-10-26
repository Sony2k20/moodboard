CREATE TYPE "public"."analysis_run_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."asset_file_kind" AS ENUM('original', 'thumb_sm', 'thumb_md', 'thumb_lg', 'capture', 'poster', 'frame');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('en', 'de');--> statement-breakpoint
CREATE TYPE "public"."origin" AS ENUM('ai', 'human');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TABLE "asset_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"kind" "asset_file_kind" NOT NULL,
	"path" text NOT NULL,
	"mime" text NOT NULL,
	"width" integer,
	"height" integer,
	"bytes" bigint NOT NULL,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"title" text,
	"description" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_url" text,
	"license" text,
	"status" "asset_status" DEFAULT 'pending' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"locale" "locale" DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_facet_value" (
	"asset_id" uuid NOT NULL,
	"facet_value_id" uuid NOT NULL,
	"origin" "origin" NOT NULL,
	"confidence" real,
	"set_by" uuid,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_facet_value_pkey" PRIMARY KEY("asset_id","facet_value_id")
);
--> statement-breakpoint
CREATE TABLE "asset_tag" (
	"asset_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"origin" "origin" NOT NULL,
	"set_by" uuid,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_tag_pkey" PRIMARY KEY("asset_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "facet_value" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facet_id" uuid NOT NULL,
	"value" varchar(64) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"label" jsonb NOT NULL,
	"description" jsonb
);
--> statement-breakpoint
CREATE TABLE "facet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(64) NOT NULL,
	"is_multi_value" boolean NOT NULL,
	"label" jsonb NOT NULL,
	"description" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "analysis_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" real,
	"raw_response" jsonb,
	"status" "analysis_run_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_color" (
	"asset_id" uuid NOT NULL,
	"hex" varchar(7) NOT NULL,
	"lab_l" real NOT NULL,
	"lab_a" real NOT NULL,
	"lab_b" real NOT NULL,
	"ratio" real NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"diff" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_search" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"tsv" "tsvector" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capture_tech" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"fonts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"css_properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"libraries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"viewport" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_file" ADD CONSTRAINT "asset_file_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_facet_value" ADD CONSTRAINT "asset_facet_value_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_facet_value" ADD CONSTRAINT "asset_facet_value_facet_value_id_facet_value_id_fk" FOREIGN KEY ("facet_value_id") REFERENCES "public"."facet_value"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_facet_value" ADD CONSTRAINT "asset_facet_value_set_by_user_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag" ADD CONSTRAINT "asset_tag_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag" ADD CONSTRAINT "asset_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag" ADD CONSTRAINT "asset_tag_set_by_user_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facet_value" ADD CONSTRAINT "facet_value_facet_id_facet_id_fk" FOREIGN KEY ("facet_id") REFERENCES "public"."facet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_run" ADD CONSTRAINT "analysis_run_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_color" ADD CONSTRAINT "asset_color_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_search" ADD CONSTRAINT "asset_search_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_tech" ADD CONSTRAINT "capture_tech_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_file_asset_id_idx" ON "asset_file" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_file_path_key" ON "asset_file" USING btree ("path");--> statement-breakpoint
CREATE INDEX "asset_created_at_idx" ON "asset" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "asset_created_by_idx" ON "asset" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "asset_status_idx" ON "asset" USING btree ("status");--> statement-breakpoint
CREATE INDEX "asset_deleted_at_idx" ON "asset" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_sub_key" ON "user" USING btree ("sub");--> statement-breakpoint
CREATE INDEX "asset_facet_value_facet_value_id_idx" ON "asset_facet_value" USING btree ("facet_value_id");--> statement-breakpoint
CREATE INDEX "asset_facet_value_origin_idx" ON "asset_facet_value" USING btree ("origin");--> statement-breakpoint
CREATE INDEX "asset_tag_tag_id_idx" ON "asset_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "facet_value_facet_id_value_key" ON "facet_value" USING btree ("facet_id","value");--> statement-breakpoint
CREATE UNIQUE INDEX "facet_key_key" ON "facet" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_name_key" ON "tag" USING btree ("name");--> statement-breakpoint
CREATE INDEX "analysis_run_asset_id_idx" ON "analysis_run" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "analysis_run_prompt_version_idx" ON "analysis_run" USING btree ("prompt_version");--> statement-breakpoint
CREATE INDEX "asset_color_asset_id_idx" ON "asset_color" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "asset_search_tsv_idx" ON "asset_search" USING gin ("tsv");