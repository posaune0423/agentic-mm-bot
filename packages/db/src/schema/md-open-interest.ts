/**
 * md_open_interest - Market Open Interest (時系列 append)
 *
 * Phase 3 (plan): OIを marketStatistics からポーリングして時系列化し、レジーム判定に利用できる土台を作る。
 *
 * Notes:
 * - OIはWSストリームが無い/不安定なvenueがあるため、ingestorがREST/SDKポーリングで取得した値をappendする。
 * - 値の単位はvenue依存。Extendedでは「base units / quote(or collateral) value」が返ることがあるため両方保持する。
 */

import { index, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const mdOpenInterest = pgTable(
  "md_open_interest",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ts: timestamp("ts", { withTimezone: true, mode: "date" }).notNull(),
    exchange: text("exchange").notNull(),
    symbol: text("symbol").notNull(),
    /** Open interest in base units (if provided) */
    openInterest: numeric("open_interest"),
    /** Open interest in USD / quote / collateral value (if provided) */
    openInterestUsd: numeric("open_interest_usd"),
    ingestTs: timestamp("ingest_ts", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    rawJson: jsonb("raw_json"),
  },
  table => [index("md_open_interest_exchange_symbol_ts_idx").on(table.exchange, table.symbol, table.ts.desc())],
);

export type MdOpenInterest = typeof mdOpenInterest.$inferSelect;
export type NewMdOpenInterest = typeof mdOpenInterest.$inferInsert;
