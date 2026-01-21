/**
 * strategy_params - Strategy Parameters (現行params)
 *
 * Requirements: 7.1, 12.4
 * - 10 base parameters for quote calculation
 * - Attack-defense parameters for improved inventory management
 * - is_current = true for active params set
 */

import { boolean, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const strategyParams = pgTable("strategy_params", {
  id: uuid("id").primaryKey().defaultRandom(), // params_set_id
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  isCurrent: boolean("is_current").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  createdBy: text("created_by").notNull(), // manual/llm

  // Quote calculation parameters (base)
  baseHalfSpreadBps: numeric("base_half_spread_bps").notNull(),
  volSpreadGain: numeric("vol_spread_gain").notNull(),
  toxSpreadGain: numeric("tox_spread_gain").notNull(),
  quoteSizeUsd: numeric("quote_size_base").notNull(),
  refreshIntervalMs: integer("refresh_interval_ms").notNull(),
  staleCancelMs: integer("stale_cancel_ms").notNull(),
  maxInventory: numeric("max_inventory").notNull(),
  inventorySkewGain: numeric("inventory_skew_gain").notNull(),
  pauseMarkIndexBps: numeric("pause_mark_index_bps").notNull(),
  pauseLiqCount10s: integer("pause_liq_count_10s").notNull(),

  // Attack-defense parameters (optional, with defaults in core)
  defensiveSpreadMultiplier: numeric("defensive_spread_multiplier"), // default 1.5
  defensiveSizeMultiplier: numeric("defensive_size_multiplier"), // default 0.5
  oneSidedThreshold: numeric("one_sided_threshold"), // default 0.3
  oneSidedOnNonZeroInventory: boolean("one_sided_on_non_zero_inventory"), // default false
  unwindTriggerMs: integer("unwind_trigger_ms"), // default 30000
  unwindSizeRatio: numeric("unwind_size_ratio"), // default 0.25
  unwindCrossBps: numeric("unwind_cross_bps"), // default 0

  comment: text("comment"),
});

export type StrategyParams = typeof strategyParams.$inferSelect;
export type NewStrategyParams = typeof strategyParams.$inferInsert;
