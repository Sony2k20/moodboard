CREATE TABLE "asset_font" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"family" text NOT NULL,
	"subfamily" text,
	"full_name" text,
	"postscript_name" text,
	"version" text,
	"designer" text,
	"manufacturer" text,
	"license" text,
	"license_url" text,
	"weight" integer,
	"italic" boolean DEFAULT false NOT NULL,
	"monospace" boolean DEFAULT false NOT NULL,
	"glyph_count" integer NOT NULL,
	"axes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_font" ADD CONSTRAINT "asset_font_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;