/**
 * md_price - Market Data Price (Mark/Index) (時系列 append)
 *
 * Requirements: 3.2, 12.1, 12.2, 12.4
 * - Mark and Index price data appended from ingestor
 * - Used for mark-index divergence calculation
 */

import { index, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const mdPrice = pgTable(
  "md_price",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ts: timestamp("ts", { withTimezone: true, mode: "date" }).notNull(),
    exchange: text("exchange").notNull(),
    symbol: text("symbol").notNull(),
    markPx: numeric("mark_px"),
    indexPx: numeric("index_px"),
    ingestTs: timestamp("ingest_ts", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    rawJson: jsonb("raw_json"),
  },
  table => [index("md_price_exchange_symbol_ts_idx").on(table.exchange, table.symbol, table.ts.desc())],
);

export type MdPrice = typeof mdPrice.$inferSelect;
export type NewMdPrice = typeof mdPrice.$inferInsert;
