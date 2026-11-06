ALTER TABLE "payments" ALTER COLUMN "party_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "party_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "avg_cost" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD COLUMN "line_no" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "line_no" integer DEFAULT 1 NOT NULL;