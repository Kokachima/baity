ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "idempotency_key" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_order_items_variant_id" ON "order_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_order_items_order_id" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_orders_status" ON "orders" USING btree ("status");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_idempotency_key_unique" UNIQUE("idempotency_key");
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;