ALTER TABLE "return_requests" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "is_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "hidden_reason" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_orders_created_at" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_orders_delivered_at" ON "orders" USING btree ("delivered_at");--> statement-breakpoint
CREATE INDEX "idx_return_requests_status_updated" ON "return_requests" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "idx_reviews_visible_reply" ON "reviews" USING btree ("is_visible","seller_replied_at","created_at");--> statement-breakpoint
CREATE INDEX "idx_users_created_at" ON "users" USING btree ("created_at");--> statement-breakpoint
UPDATE "faq_policies"
SET "content" = REPLACE(
  "content",
  'hệ thống tuyệt đối không lưu trữ ảnh tìm kiếm ở bất kỳ đâu (không lưu vào bộ nhớ đám mây hay cơ sở dữ liệu).',
  'Baity không lưu ảnh trong hệ thống của cửa hàng; ảnh được gửi tới Google Gemini và do Google xử lý theo chính sách của Google; quý khách không nên tải ảnh có khuôn mặt hoặc thông tin cá nhân.'
)
WHERE "slug" = 'privacy' AND "content" LIKE '%tuyệt đối không lưu trữ ảnh%';--> statement-breakpoint
UPDATE "faq_policies"
SET "content" = REPLACE(
  "content",
  'hệ thống tuyệt đối không lưu trữ ảnh ở bất kỳ đâu;',
  'Baity không lưu ảnh trong hệ thống của cửa hàng; ảnh được gửi tới Google Gemini và do Google xử lý theo chính sách của Google; khách hàng không nên tải ảnh có khuôn mặt hoặc thông tin cá nhân.'
)
WHERE "slug" = 'faq-ai-features' AND "content" LIKE '%tuyệt đối không lưu trữ ảnh%';