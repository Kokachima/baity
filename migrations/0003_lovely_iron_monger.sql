ALTER TABLE "return_requests" ADD COLUMN IF NOT EXISTS "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "return_requests" ADD COLUMN IF NOT EXISTS "refund_amount" integer;--> statement-breakpoint
ALTER TABLE "return_requests" ADD COLUMN IF NOT EXISTS "description" text;