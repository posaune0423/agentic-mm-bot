/**
 * ex_fill - Fills (約定)
 *
 * Requirements: 4.4, 9.1, 12.4
 * - All fills persisted for summarizer and audit
 * - Referenced by fills_enriched for markout calculation
 */

import { index, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const exFill = pgTable(
  "ex_fill",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ts: timestamp("ts", { withTimezone: true, mode: "date" }).notNull(),
    exchange: text("exchange").notNull(),
    symbol: text("symbol").notNull(),
    clientOrderId: text("client_order_id").notNull(),
    exchangeOrderId: text("exchange_order_id"),
    side: text("side").notNull(), // buy/sell (bot's perspective)
    fillPx: numeric("fill_px").notNull(),
    fillSz: numeric("fill_sz").notNull(),
    fee: numeric("fee"),
    liquidity: text("liquidity"), // maker/taker (expected: maker)
    state: text("state").notNull(), // NORMAL/DEFENSIVE/PAUSE
    paramsSetId: uuid("params_set_id").notNull(),
    rawJson: jsonb("raw_json"),
  },
  table => [index("ex_fill_exchange_symbol_ts_idx").on(table.exchange, table.symbol, table.ts.desc())],
);

export type ExFill = typeof exFill.$inferSelect;
export type NewExFill = typeof exFill.$inferInsert;
