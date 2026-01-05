CREATE TABLE "md_bbo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"exchange" text NOT NULL,
	"symbol" text NOT NULL,
	"best_bid_px" numeric NOT NULL,
	"best_bid_sz" numeric NOT NULL,
	"best_ask_px" numeric NOT NULL,
	"best_ask_sz" numeric NOT NULL,
	"mid_px" numeric NOT NULL,
	"seq" bigint,
	"ingest_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "md_trade" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"exchange" text NOT NULL,
	"symbol" text NOT NULL,
	"trade_id" text,
	"side" text,
	"px" numeric NOT NULL,
	"sz" numeric NOT NULL,
	"type" text,
	"seq" bigint,
	"ingest_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "md_price" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"exchange" text NOT NULL,
	"symbol" text NOT NULL,
	"mark_px" numeric,
	"index_px" numeric,
	"ingest_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "latest_top" (
	"exchange" text NOT NULL,
	"symbol" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"best_bid_px" numeric NOT NULL,
	"best_bid_sz" numeric NOT NULL,
	"best_ask_px" numeric NOT NULL,
	"best_ask_sz" numeric NOT NULL,
	"mid_px" numeric NOT NULL,
	"mark_px" numeric,
	"index_px" numeric,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "latest_top_exchange_symbol_pk" PRIMARY KEY("exchange","symbol")
);
--> statement-breakpoint
CREATE TABLE "latest_position" (
	"exchange" text NOT NULL,
	"symbol" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"position_sz" numeric NOT NULL,
	"entry_px" numeric,
	"unrealized_pnl" numeric,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "latest_position_exchange_symbol_pk" PRIMARY KEY("exchange","symbol")
);
--> statement-breakpoint
CREATE TABLE "ex_order_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"exchange" text NOT NULL,
	"symbol" text NOT NULL,
	"client_order_id" text NOT NULL,
	"exchange_order_id" text,
	"event_type" text NOT NULL,
	"side" text,
	"px" numeric,
	"sz" numeric,
	"post_only" boolean NOT NULL,
	"reason" text,
	"state" text,
	"params_set_id" uuid,
	"raw_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "ex_fill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"exchange" text NOT NULL,
	"symbol" text NOT NULL,
	"client_order_id" text NOT NULL,
	"exchange_order_id" text,
	"side" text NOT NULL,
	"fill_px" numeric NOT NULL,
	"fill_sz" numeric NOT NULL,
	"fee" numeric,
	"liquidity" text,
	"state" text NOT NULL,
	"params_set_id" uuid NOT NULL,
	"raw_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "fills_enriched" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fill_id" uuid NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"exchange" text NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"fill_px" numeric NOT NULL,
	"fill_sz" numeric NOT NULL,
	"mid_t0" numeric,
	"mid_t1s" numeric,
	"mid_t10s" numeric,
	"mid_t60s" numeric,
	"markout_1s_bps" numeric,
	"markout_10s_bps" numeric,
	"markout_60s_bps" numeric,
	"spread_bps_t0" numeric,
	"trade_imbalance_1s_t0" numeric,
	"realized_vol_10s_t0" numeric,
	"mark_index_div_bps_t0" numeric,
	"liq_count_10s_t0" integer,
	"state" text NOT NULL,
	"params_set_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_params" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exchange" text NOT NULL,
	"symbol" text NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"base_half_spread_bps" numeric NOT NULL,
	"vol_spread_gain" numeric NOT NULL,
	"tox_spread_gain" numeric NOT NULL,
	"quote_size_base" numeric NOT NULL,
	"refresh_interval_ms" integer NOT NULL,
	"stale_cancel_ms" integer NOT NULL,
	"max_inventory" numeric NOT NULL,
	"inventory_skew_gain" numeric NOT NULL,
	"pause_mark_index_bps" numeric NOT NULL,
	"pause_liq_count_10s" integer NOT NULL,
	"comment" text
);
--> statement-breakpoint
CREATE TABLE "strategy_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"exchange" text NOT NULL,
	"symbol" text NOT NULL,
	"mode" text NOT NULL,
	"mode_since" timestamp with time zone,
	"pause_until" timestamp with time zone,
	"params_set_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exchange" text NOT NULL,
	"symbol" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"input_window_start" timestamp with time zone NOT NULL,
	"input_window_end" timestamp with time zone NOT NULL,
	"current_params_set_id" uuid NOT NULL,
	"proposal_json" jsonb NOT NULL,
	"rollback_json" jsonb NOT NULL,
	"reasoning_log_path" text NOT NULL,
	"reasoning_log_sha256" text NOT NULL,
	"status" text NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"reject_reason" text
);
--> statement-breakpoint
CREATE TABLE "param_rollout" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"exchange" text NOT NULL,
	"symbol" text NOT NULL,
	"proposal_id" uuid,
	"from_params_set_id" uuid NOT NULL,
	"to_params_set_id" uuid,
	"action" text NOT NULL,
	"reason" text,
	"metrics_snapshot_json" jsonb
);
--> statement-breakpoint
ALTER TABLE "fills_enriched" ADD CONSTRAINT "fills_enriched_fill_id_ex_fill_id_fk" FOREIGN KEY ("fill_id") REFERENCES "public"."ex_fill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "md_bbo_exchange_symbol_ts_idx" ON "md_bbo" USING btree ("exchange","symbol","ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "md_trade_exchange_symbol_ts_idx" ON "md_trade" USING btree ("exchange","symbol","ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "md_price_exchange_symbol_ts_idx" ON "md_price" USING btree ("exchange","symbol","ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ex_order_event_exchange_symbol_ts_idx" ON "ex_order_event" USING btree ("exchange","symbol","ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ex_order_event_client_order_id_idx" ON "ex_order_event" USING btree ("client_order_id");--> statement-breakpoint
CREATE INDEX "ex_fill_exchange_symbol_ts_idx" ON "ex_fill" USING btree ("exchange","symbol","ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "fills_enriched_exchange_symbol_ts_idx" ON "fills_enriched" USING btree ("exchange","symbol","ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "fills_enriched_fill_id_idx" ON "fills_enriched" USING btree ("fill_id");--> statement-breakpoint
CREATE INDEX "strategy_state_exchange_symbol_ts_idx" ON "strategy_state" USING btree ("exchange","symbol","ts" DESC NULLS LAST);