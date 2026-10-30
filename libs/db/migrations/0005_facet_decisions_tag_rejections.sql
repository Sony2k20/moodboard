CREATE TABLE "asset_facet_decision" (
	"asset_id" uuid NOT NULL,
	"facet_id" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_facet_decision_pkey" PRIMARY KEY("asset_id","facet_id")
);
--> statement-breakpoint
CREATE TABLE "asset_tag_rejection" (
	"asset_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"rejected_by" uuid,
	"rejected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_tag_rejection_pkey" PRIMARY KEY("asset_id","tag_id")
);
--> statement-breakpoint
DROP INDEX "asset_deleted_at_idx";--> statement-breakpoint
ALTER TABLE "asset_facet_decision" ADD CONSTRAINT "asset_facet_decision_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_facet_decision" ADD CONSTRAINT "asset_facet_decision_facet_id_facet_id_fk" FOREIGN KEY ("facet_id") REFERENCES "public"."facet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_facet_decision" ADD CONSTRAINT "asset_facet_decision_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag_rejection" ADD CONSTRAINT "asset_tag_rejection_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag_rejection" ADD CONSTRAINT "asset_tag_rejection_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag_rejection" ADD CONSTRAINT "asset_tag_rejection_rejected_by_user_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_deleted_at_idx" ON "asset" USING btree ("deleted_at") WHERE "asset"."deleted_at" is not null;