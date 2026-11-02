CREATE TYPE "public"."board_kind" AS ENUM('manual', 'smart');--> statement-breakpoint
CREATE TYPE "public"."board_role" AS ENUM('overall', 'color', 'layout', 'typography', 'motion', 'imagery', 'copy');--> statement-breakpoint
CREATE TYPE "public"."board_weight" AS ENUM('primary', 'secondary', 'avoid');--> statement-breakpoint
CREATE TABLE "board_filter" (
	"board_id" uuid NOT NULL,
	"filter" jsonb NOT NULL,
	CONSTRAINT "board_filter_board_id_pk" PRIMARY KEY("board_id")
);
--> statement-breakpoint
CREATE TABLE "board_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"role" "board_role" DEFAULT 'overall' NOT NULL,
	"weight" "board_weight" DEFAULT 'primary' NOT NULL,
	"note" text,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"briefing" text DEFAULT '' NOT NULL,
	"kind" "board_kind" DEFAULT 'manual' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_filter" ADD CONSTRAINT "board_filter_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_item" ADD CONSTRAINT "board_item_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_item" ADD CONSTRAINT "board_item_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_item" ADD CONSTRAINT "board_item_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board" ADD CONSTRAINT "board_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board" ADD CONSTRAINT "board_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_item_board_asset_role_key" ON "board_item" USING btree ("board_id","asset_id","role");--> statement-breakpoint
CREATE INDEX "board_item_board_position_idx" ON "board_item" USING btree ("board_id","position");--> statement-breakpoint
CREATE INDEX "board_item_asset_id_idx" ON "board_item" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "board_updated_at_idx" ON "board" USING btree ("updated_at" DESC NULLS LAST);