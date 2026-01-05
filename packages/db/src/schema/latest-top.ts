/**
 * latest_top - Latest Market Data (1行/シンボル upsert)
 *
 * Requirements: 3.3, 12.4
 * - Continuously upserted by ingestor for executor fast lookup
 * - Composite PK: (exchange, symbol)
 */

import {
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const latestTop = pgTable(
  "latest_top",
  {
    exchange: text("exchange").notNull(),
    symbol: text("symbol").notNull(),
    ts: timestamp("ts", { withTimezone: true, mode: "date" }).notNull(),
    bestBidPx: numeric("best_bid_px").notNull(),
    bestBidSz: numeric("best_bid_sz").notNull(),
    bestAskPx: numeric("best_ask_px").notNull(),
    bestAskSz: numeric("best_ask_sz").notNull(),
    midPx: numeric("mid_px").notNull(),
    markPx: numeric("mark_px"),
    indexPx: numeric("index_px"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.exchange, table.symbol] })],
);

export type LatestTop = typeof latestTop.$inferSelect;
export type NewLatestTop = typeof latestTop.$inferInsert;
