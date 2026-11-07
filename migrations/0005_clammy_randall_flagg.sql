ALTER TABLE "vouchers" ALTER COLUMN "usage_limit" DROP NOT NULL;--> statement-breakpoint
DELETE FROM "cart_items" a USING "cart_items" b WHERE a.user_id IS NOT NULL AND a.user_id = b.user_id AND a.variant_id = b.variant_id AND a.id < b.id;--> statement-breakpoint
DELETE FROM "cart_items" a USING "cart_items" b WHERE a.session_id IS NOT NULL AND a.session_id = b.session_id AND a.variant_id = b.variant_id AND a.id < b.id;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "uniq_cart_items_user_variant" UNIQUE("user_id","variant_id");--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "uniq_cart_items_session_variant" UNIQUE("session_id","variant_id");