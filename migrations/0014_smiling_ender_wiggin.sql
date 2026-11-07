ALTER TABLE "chat_conversations" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD COLUMN "last_message_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD COLUMN "user_last_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD COLUMN "admin_last_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "return_requests" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
UPDATE "return_requests" SET "refunded_at" = "updated_at" WHERE "status" = 'completed' AND "refunded_at" IS NULL;--> statement-breakpoint
UPDATE "chat_conversations" SET "status" = 'open' WHERE "status" NOT IN ('open', 'closed');--> statement-breakpoint
UPDATE "chat_conversations" SET "unread_admin" = GREATEST(0, "unread_admin"), "unread_user" = GREATEST(0, "unread_user") WHERE "unread_admin" < 0 OR "unread_user" < 0;--> statement-breakpoint
WITH ranked_open AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "user_id" ORDER BY "updated_at" DESC, "id" DESC) AS rn
  FROM "chat_conversations"
  WHERE "status" = 'open' AND "user_id" IS NOT NULL
)
UPDATE "chat_conversations" c
SET "status" = 'closed', "closed_at" = COALESCE(c."closed_at", now())
FROM ranked_open r
WHERE c."id" = r."id" AND r.rn > 1;--> statement-breakpoint
DELETE FROM "chat_messages" WHERE char_length("content") < 1;--> statement-breakpoint
UPDATE "chat_messages" SET "content" = SUBSTRING("content" FROM 1 FOR 1000) WHERE char_length("content") > 1000;--> statement-breakpoint
CREATE INDEX "idx_chat_conv_status_last_msg" ON "chat_conversations" USING btree ("status","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_chat_conv_single_open_user" ON "chat_conversations" USING btree ("user_id") WHERE "chat_conversations"."status" = 'open';--> statement-breakpoint
CREATE INDEX "idx_chat_messages_conv_created" ON "chat_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_return_requests_status_refunded" ON "return_requests" USING btree ("status","refunded_at");--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_status_check" CHECK ("chat_conversations"."status" IN ('open', 'closed'));--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "check_chat_conv_unread_non_negative" CHECK ("chat_conversations"."unread_admin" >= 0 AND "chat_conversations"."unread_user" >= 0);--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_content_length_check" CHECK (char_length("chat_messages"."content") >= 1 AND char_length("chat_messages"."content") <= 1000);--> statement-breakpoint
ALTER TABLE "return_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "faq_policies"
SET "content" = "content" || E'\n\n- **Chat với người bán (Hỏi đáp trực tiếp với chủ cửa hàng)**: Khi quý khách đã đăng nhập và sử dụng tính năng **Chat với người bán**, **nội dung tin nhắn KHÔNG bao giờ được gửi tới Google Gemini và không ghi vào nhật ký hệ thống (logs)**. Nội dung chat với người bán được **lưu trong cơ sở dữ liệu của cửa hàng**, **chủ cửa hàng xem được** để phản hồi hỗ trợ quý khách. Các hội thoại đã đóng được **lưu tối đa {{seller_chat_retention_days}} ngày sau khi đóng rồi hệ thống tự động xóa**, hoặc được xóa sớm theo yêu cầu của quý khách thông qua liên hệ của cửa hàng; khi xóa tài khoản khách hàng thì toàn bộ hội thoại của quý khách cũng được xóa tự động. Quý khách tuyệt đối **không nhập mật khẩu, mã xác thực OTP, số thẻ ngân hàng hoặc số CCCD** vào hộp chat.'
WHERE "slug" = 'privacy' AND "content" NOT LIKE '%Chat với người bán%';--> statement-breakpoint
UPDATE "faq_policies"
SET "content" = "content" || ' Ngoài ra, khi đã đăng nhập, bạn có thể chuyển sang mục **Chat với người bán** ngay trong hộp chat để nhắn tin hỏi đáp trực tiếp với cửa hàng: **nội dung chat với người bán KHÔNG bao giờ được gửi sang Google Gemini, được lưu trong cơ sở dữ liệu cửa hàng để chủ cửa hàng xem và phản hồi, lưu tối đa {{seller_chat_retention_days}} ngày sau khi đóng hội thoại rồi tự động xóa (hoặc xóa sớm theo yêu cầu qua liên hệ của cửa hàng; xóa tài khoản khách hàng sẽ xóa toàn bộ hội thoại), và bạn tuyệt đối không nhập mật khẩu, mã OTP, số thẻ ngân hàng hay số CCCD vào hộp chat.**'
WHERE "slug" = 'faq-ai-features' AND "content" NOT LIKE '%Chat với người bán%';