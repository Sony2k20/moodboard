CREATE TABLE "component_code" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"html" text NOT NULL,
	"css" text DEFAULT '' NOT NULL,
	"js" text DEFAULT '' NOT NULL,
	"width" integer DEFAULT 1280 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "component_code" ADD CONSTRAINT "component_code_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_code" ADD CONSTRAINT "component_code_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;