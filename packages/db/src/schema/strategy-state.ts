/**
 * strategy_state - Strategy State Snapshots (復旧用)
 *
 * Requirements: 4.11, 5.1, 12.4
 * - Periodic snapshots for recovery
 * - Contains mode (NORMAL/DEFENSIVE/PAUSE)
 */

import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const strategyState = pgTable(
  "strategy_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ts: timestamp("ts", { withTimezone: true, mode: "date" }).notNull(),
    exchange: text("exchange").notNull(),
    symbol: text("symbol").notNull(),
    mode: text("mode").notNull(), // NORMAL/DEFENSIVE/PAUSE
    modeSince: timestamp("mode_since", { withTimezone: true, mode: "date" }),
    pauseUntil: timestamp("pause_until", { withTimezone: true, mode: "date" }),
    paramsSetId: uuid("params_set_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  table => [index("strategy_state_exchange_symbol_ts_idx").on(table.exchange, table.symbol, table.ts.desc())],
);

export type StrategyState = typeof strategyState.$inferSelect;
export type NewStrategyState = typeof strategyState.$inferInsert;
