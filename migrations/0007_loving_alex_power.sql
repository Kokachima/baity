CREATE TABLE IF NOT EXISTS "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"object_path" text NOT NULL,
	"purpose" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uploads_object_path_unique" UNIQUE("object_path")
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_uploads_user_purpose" ON "uploads" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_uploads_object_path" ON "uploads" USING btree ("object_path");--> statement-breakpoint
ALTER TABLE "uploads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "addresses" DROP CONSTRAINT IF EXISTS "addresses_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" DROP CONSTRAINT IF EXISTS "cart_items_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" DROP CONSTRAINT IF EXISTS "cart_items_variant_id_product_variants_id_fk";--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" DROP CONSTRAINT IF EXISTS "chat_conversations_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" DROP CONSTRAINT IF EXISTS "chat_messages_conversation_id_chat_conversations_id_fk";--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "order_items_order_id_orders_id_fk";--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "order_items_variant_id_product_variants_id_fk";--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" DROP CONSTRAINT IF EXISTS "order_status_history_order_id_orders_id_fk";--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_order_id_orders_id_fk";--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attributes" DROP CONSTRAINT IF EXISTS "product_attributes_product_id_products_id_fk";--> statement-breakpoint
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" DROP CONSTRAINT IF EXISTS "product_images_product_id_products_id_fk";--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" DROP CONSTRAINT IF EXISTS "product_variants_product_id_products_id_fk";--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_category_id_categories_id_fk";--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_targets" DROP CONSTRAINT IF EXISTS "promotion_targets_promotion_id_promotions_id_fk";--> statement-breakpoint
ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" DROP CONSTRAINT IF EXISTS "return_requests_order_id_orders_id_fk";--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" DROP CONSTRAINT IF EXISTS "return_requests_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" DROP CONSTRAINT IF EXISTS "return_requests_order_item_id_order_items_id_fk";--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_images" DROP CONSTRAINT IF EXISTS "review_images_review_id_reviews_id_fk";--> statement-breakpoint
ALTER TABLE "review_images" ADD CONSTRAINT "review_images_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT IF EXISTS "reviews_product_id_products_id_fk";--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT IF EXISTS "reviews_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT IF EXISTS "reviews_order_id_orders_id_fk";--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT IF EXISTS "stock_movements_variant_id_product_variants_id_fk";--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_usages" DROP CONSTRAINT IF EXISTS "voucher_usages_voucher_id_vouchers_id_fk";--> statement-breakpoint
ALTER TABLE "voucher_usages" ADD CONSTRAINT "voucher_usages_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_usages" DROP CONSTRAINT IF EXISTS "voucher_usages_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "voucher_usages" ADD CONSTRAINT "voucher_usages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" DROP CONSTRAINT IF EXISTS "vouchers_applicable_category_id_categories_id_fk";--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_applicable_category_id_categories_id_fk" FOREIGN KEY ("applicable_category_id") REFERENCES "categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" DROP CONSTRAINT IF EXISTS "wishlist_items_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" DROP CONSTRAINT IF EXISTS "wishlist_items_product_id_products_id_fk";--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" DROP CONSTRAINT IF EXISTS "addresses_user_id_fkey";--> statement-breakpoint
ALTER TABLE "cart_items" DROP CONSTRAINT IF EXISTS "cart_items_user_id_fkey";--> statement-breakpoint
ALTER TABLE "cart_items" DROP CONSTRAINT IF EXISTS "cart_items_variant_id_fkey";--> statement-breakpoint
ALTER TABLE "chat_conversations" DROP CONSTRAINT IF EXISTS "chat_conversations_user_id_fkey";--> statement-breakpoint
ALTER TABLE "chat_messages" DROP CONSTRAINT IF EXISTS "chat_messages_conversation_id_fkey";--> statement-breakpoint
ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "order_items_order_id_fkey";--> statement-breakpoint
ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "order_items_variant_id_fkey";--> statement-breakpoint
ALTER TABLE "order_status_history" DROP CONSTRAINT IF EXISTS "order_status_history_order_id_fkey";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_user_id_fkey";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_order_id_fkey";--> statement-breakpoint
ALTER TABLE "product_attributes" DROP CONSTRAINT IF EXISTS "product_attributes_product_id_fkey";--> statement-breakpoint
ALTER TABLE "product_images" DROP CONSTRAINT IF EXISTS "product_images_product_id_fkey";--> statement-breakpoint
ALTER TABLE "product_variants" DROP CONSTRAINT IF EXISTS "product_variants_product_id_fkey";--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_category_id_fkey";--> statement-breakpoint
ALTER TABLE "promotion_targets" DROP CONSTRAINT IF EXISTS "promotion_targets_promotion_id_fkey";--> statement-breakpoint
ALTER TABLE "return_requests" DROP CONSTRAINT IF EXISTS "return_requests_order_id_fkey";--> statement-breakpoint
ALTER TABLE "return_requests" DROP CONSTRAINT IF EXISTS "return_requests_order_item_id_fkey";--> statement-breakpoint
ALTER TABLE "return_requests" DROP CONSTRAINT IF EXISTS "return_requests_user_id_fkey";--> statement-breakpoint
ALTER TABLE "review_images" DROP CONSTRAINT IF EXISTS "review_images_review_id_fkey";--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT IF EXISTS "reviews_order_id_fkey";--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT IF EXISTS "reviews_product_id_fkey";--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT IF EXISTS "reviews_user_id_fkey";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT IF EXISTS "stock_movements_variant_id_fkey";--> statement-breakpoint
ALTER TABLE "voucher_usages" DROP CONSTRAINT IF EXISTS "voucher_usages_user_id_fkey";--> statement-breakpoint
ALTER TABLE "voucher_usages" DROP CONSTRAINT IF EXISTS "voucher_usages_voucher_id_fkey";--> statement-breakpoint
ALTER TABLE "vouchers" DROP CONSTRAINT IF EXISTS "vouchers_applicable_category_id_fkey";--> statement-breakpoint
ALTER TABLE "wishlist_items" DROP CONSTRAINT IF EXISTS "wishlist_items_product_id_fkey";--> statement-breakpoint
ALTER TABLE "wishlist_items" DROP CONSTRAINT IF EXISTS "wishlist_items_user_id_fkey";--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "categories" ADD CONSTRAINT "categories_slug_unique" UNIQUE("slug"); EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS "categories_slug_key";--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "payments" ADD CONSTRAINT "payments_transaction_id_unique" UNIQUE("transaction_id"); EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_transaction_id_key";--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_sku_unique" UNIQUE("sku"); EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "product_variants" DROP CONSTRAINT IF EXISTS "product_variants_sku_key";--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "products" ADD CONSTRAINT "products_slug_unique" UNIQUE("slug"); EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_slug_key";--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "reviews" ADD CONSTRAINT "uniq_user_product_order_review" UNIQUE("user_id","product_id","order_id"); EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT IF EXISTS "reviews_user_id_product_id_order_id_key";--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email"); EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_email_key";--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_code_unique" UNIQUE("code"); EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "vouchers" DROP CONSTRAINT IF EXISTS "vouchers_code_key";--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "wishlist_items" ADD CONSTRAINT "uniq_wishlist_user_product" UNIQUE("user_id","product_id"); EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "wishlist_items" DROP CONSTRAINT IF EXISTS "wishlist_items_user_id_product_id_key";--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "cart_items" ADD CONSTRAINT "check_cart_quantity_positive" CHECK ("cart_items"."quantity" > 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "cart_items" DROP CONSTRAINT IF EXISTS "cart_items_quantity_check";--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "product_variants" ADD CONSTRAINT "check_stock_non_negative" CHECK ("product_variants"."stock_quantity" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "product_variants" DROP CONSTRAINT IF EXISTS "product_variants_stock_quantity_check";--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "reviews" ADD CONSTRAINT "check_review_rating_range" CHECK ("reviews"."rating" >= 1 AND "reviews"."rating" <= 5); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT IF EXISTS "reviews_rating_check";--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_target_gender_check";--> statement-breakpoint
ALTER TABLE "promotion_targets" DROP CONSTRAINT IF EXISTS "promotion_targets_target_type_check";--> statement-breakpoint
ALTER TABLE "vouchers" DROP CONSTRAINT IF EXISTS "vouchers_discount_type_check";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_chat_conversations_user_mode";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_chat_messages_conv";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_order_status_history_order";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_orders_user_status";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_product_attrs_key";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_promo_targets_promo";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_promo_targets_type_id";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_promotions_time";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_review_images_review";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_stock_movements_variant";