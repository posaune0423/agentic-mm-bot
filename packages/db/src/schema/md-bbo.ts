/**
 * md_bbo - Market Data Best Bid/Offer (時系列 append)
 *
 * Requirements: 3.2, 12.1, 12.2, 12.4
 * - BBO data appended from ingestor
 * - (exchange, symbol, ts DESC) index for efficient queries
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

export const mdBbo = pgTable(
  "md_bbo",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ts: timestamp("ts", { withTimezone: true, mode: "date" }).notNull(),
    exchange: text("exchange").notNull(),
    symbol: text("symbol").notNull(),
    bestBidPx: numeric("best_bid_px").notNull(),
    bestBidSz: numeric("best_bid_sz").notNull(),
    bestAskPx: numeric("best_ask_px").notNull(),
    bestAskSz: numeric("best_ask_sz").notNull(),
    midPx: numeric("mid_px").notNull(),
    seq: bigint("seq", { mode: "number" }),
    ingestTs: timestamp("ingest_ts", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    rawJson: jsonb("raw_json"),
  },
  (table) => [
    index("md_bbo_exchange_symbol_ts_idx").on(
      table.exchange,
      table.symbol,
      table.ts.desc(),
    ),
  ],
);

export type MdBbo = typeof mdBbo.$inferSelect;
export type NewMdBbo = typeof mdBbo.$inferInsert;
