CREATE TABLE "admin_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chatbot_daily_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date_key" text NOT NULL,
	"scope_key" text NOT NULL,
	"call_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_chatbot_daily_counters_date_scope" UNIQUE("date_key","scope_key"),
	CONSTRAINT "check_chatbot_call_count_non_negative" CHECK ("chatbot_daily_counters"."call_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_admin_audit_logs_admin_id" ON "admin_audit_logs" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "idx_admin_audit_logs_target" ON "admin_audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "idx_admin_audit_logs_created_at" ON "admin_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_chatbot_daily_counters_date" ON "chatbot_daily_counters" USING btree ("date_key");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "check_order_items_quantity_positive" CHECK ("order_items"."quantity" >= 1);--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "check_order_items_unit_price_non_negative" CHECK ("order_items"."unit_price" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "check_orders_total_amount_non_negative" CHECK ("orders"."total_amount" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "check_orders_discount_amount_non_negative" CHECK ("orders"."discount_amount" >= 0);--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "check_variants_price_override_non_negative" CHECK ("product_variants"."price_override" >= 0 OR "product_variants"."price_override" IS NULL);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "check_products_base_price_non_negative" CHECK ("products"."base_price" >= 0);--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "check_vouchers_used_count_non_negative" CHECK ("vouchers"."used_count" >= 0);--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chatbot_daily_counters" ENABLE ROW LEVEL SECURITY;