ALTER TABLE "faq_policies" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "faq_policies" ADD CONSTRAINT "faq_policies_slug_unique" UNIQUE("slug");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_target_gender_check" CHECK ("products"."target_gender" IN ('men', 'women', 'unisex'));--> statement-breakpoint
ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_target_type_check" CHECK ("promotion_targets"."target_type" IN ('product', 'category'));--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_discount_type_check" CHECK ("vouchers"."discount_type" IN ('percent', 'fixed', 'free_shipping'));