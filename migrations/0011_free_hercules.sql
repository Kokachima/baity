CREATE TABLE "ai_search_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recognized_attributes" jsonb DEFAULT '{}' NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"is_success" boolean DEFAULT true NOT NULL,
	"actor_hmac" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_ai_search_logs_result_count_non_negative" CHECK ("ai_search_logs"."result_count" >= 0),
	CONSTRAINT "check_ai_search_logs_latency_non_negative" CHECK ("ai_search_logs"."latency_ms" >= 0)
);
--> statement-breakpoint
CREATE INDEX "idx_ai_search_logs_created_at" ON "ai_search_logs" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "ai_search_logs" ENABLE ROW LEVEL SECURITY;