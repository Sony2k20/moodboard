ALTER TABLE "asset" ADD COLUMN "design_notes" jsonb;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "design_notes_origin" "origin" DEFAULT 'ai' NOT NULL;