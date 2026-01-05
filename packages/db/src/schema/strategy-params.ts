/**
 * strategy_params - Strategy Parameters (現行params)
 *
 * Requirements: 7.1, 12.4
 * - 10 parameters for quote calculation
 * - is_current = true for active params set
 */

import {
  boolean,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const strategyParams = pgTable("strategy_params", {
  id: uuid("id").primaryKey().defaultRandom(), // params_set_id
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  isCurrent: boolean("is_current").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  createdBy: text("created_by").notNull(), // manual/llm

  // Quote calculation parameters
  baseHalfSpreadBps: numeric("base_half_spread_bps").notNull(),
  volSpreadGain: numeric("vol_spread_gain").notNull(),
  toxSpreadGain: numeric("tox_spread_gain").notNull(),
  quoteSizeUsd: numeric("quote_size_usd").notNull(),
  refreshIntervalMs: integer("refresh_interval_ms").notNull(),
  staleCancelMs: integer("stale_cancel_ms").notNull(),
  maxInventory: numeric("max_inventory").notNull(),
  inventorySkewGain: numeric("inventory_skew_gain").notNull(),
  pauseMarkIndexBps: numeric("pause_mark_index_bps").notNull(),
  pauseLiqCount10s: integer("pause_liq_count_10s").notNull(),

  comment: text("comment"),
});

export type StrategyParams = typeof strategyParams.$inferSelect;
export type NewStrategyParams = typeof strategyParams.$inferInsert;
