ALTER TABLE "categories" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_events" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_events" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "payment_events" ADD COLUMN "resolution_note" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "payments" SET "status" = 'paid' WHERE "status" = 'success';--> statement-breakpoint
UPDATE "payments" SET "status" = 'pending' WHERE "status" NOT IN ('pending', 'paid', 'failed', 'refunded', 'refund_needed');--> statement-breakpoint
UPDATE "uploads" SET "purpose" = 'avatar' WHERE "purpose" NOT IN ('avatar', 'review', 'return', 'product');--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_check" CHECK ("payments"."status" IN ('pending', 'paid', 'failed', 'refunded', 'refund_needed'));--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_purpose_check" CHECK ("uploads"."purpose" IN ('avatar', 'review', 'return', 'product'));