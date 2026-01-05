/**
 * latest_position - Latest Position (1行/シンボル)
 *
 * Requirements: 4.4, 12.4
 * - Continuously updated by executor
 * - Used for inventory management
 */

import {
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const latestPosition = pgTable(
  "latest_position",
  {
    exchange: text("exchange").notNull(),
    symbol: text("symbol").notNull(),
    ts: timestamp("ts", { withTimezone: true, mode: "date" }).notNull(),
    positionSz: numeric("position_sz").notNull(),
    entryPx: numeric("entry_px"),
    unrealizedPnl: numeric("unrealized_pnl"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.exchange, table.symbol] })],
);

export type LatestPosition = typeof latestPosition.$inferSelect;
export type NewLatestPosition = typeof latestPosition.$inferInsert;
