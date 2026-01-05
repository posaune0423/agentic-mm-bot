/**
 * ex_order_event - Order Events (注文イベント)
 *
 * Requirements: 4.4, 12.4
 * - All order place/cancel/ack/reject/fill events persisted
 * - Used for audit and recovery
 */

import {
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const exOrderEvent = pgTable(
  "ex_order_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ts: timestamp("ts", { withTimezone: true, mode: "date" }).notNull(),
    exchange: text("exchange").notNull(),
    symbol: text("symbol").notNull(),
    clientOrderId: text("client_order_id").notNull(),
    exchangeOrderId: text("exchange_order_id"),
    eventType: text("event_type").notNull(), // place/cancel/ack/reject/fill
    side: text("side"), // buy/sell
    px: numeric("px"),
    sz: numeric("sz"),
    postOnly: boolean("post_only").notNull(),
    reason: text("reason"),
    state: text("state"),
    paramsSetId: uuid("params_set_id"),
    rawJson: jsonb("raw_json"),
  },
  (table) => [
    index("ex_order_event_exchange_symbol_ts_idx").on(
      table.exchange,
      table.symbol,
      table.ts.desc(),
    ),
    index("ex_order_event_client_order_id_idx").on(table.clientOrderId),
  ],
);

export type ExOrderEvent = typeof exOrderEvent.$inferSelect;
export type NewExOrderEvent = typeof exOrderEvent.$inferInsert;
