/**
 * md_trade - Market Data Trades (時系列 append)
 *
 * Requirements: 3.2, 12.1, 12.2, 12.4
 * - Trade data appended from ingestor
 * - Used for feature calculation (imbalance, liq count)
 */

import {
  bigint,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const mdTrade = pgTable(
  "md_trade",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ts: timestamp("ts", { withTimezone: true, mode: "date" }).notNull(),
    exchange: text("exchange").notNull(),
    symbol: text("symbol").notNull(),
    tradeId: text("trade_id"),
    side: text("side"), // buy/sell (null if unknown)
    px: numeric("px").notNull(),
    sz: numeric("sz").notNull(),
    type: text("type"), // normal/liq/delev
    seq: bigint("seq", { mode: "number" }),
    ingestTs: timestamp("ingest_ts", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    rawJson: jsonb("raw_json"),
  },
  (table) => [
    index("md_trade_exchange_symbol_ts_idx").on(
      table.exchange,
      table.symbol,
      table.ts.desc(),
    ),
  ],
);

export type MdTrade = typeof mdTrade.$inferSelect;
export type NewMdTrade = typeof mdTrade.$inferInsert;
