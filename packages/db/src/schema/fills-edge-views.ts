import { integer, numeric, pgView, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Spread edge analysis views.
 *
 * These views are created via SQL migrations (see `migrations/0001_spread_edge_views.sql`).
 * We mark them as `.existing()` so `drizzle-kit push` won't try to drop them as "unknown objects".
 */

export const vFillsEdgeDecomposition = pgView("v_fills_edge_decomposition", {
  id: text("id"),
  fillId: text("fill_id"),
  ts: timestamp("ts", { withTimezone: true }),
  exchange: text("exchange"),
  symbol: text("symbol"),
  side: text("side"),
  fillPx: numeric("fill_px"),
  fillSz: numeric("fill_sz"),
  midT0: numeric("mid_t0"),
  markout1sBps: numeric("markout_1s_bps"),
  markout10sBps: numeric("markout_10s_bps"),
  markout60sBps: numeric("markout_60s_bps"),
  state: text("state"),
  fee: numeric("fee"),
  liquidity: text("liquidity"),
  edgeT0Bps: numeric("edge_t0_bps"),
  notionalT0: numeric("notional_t0"),
  priceMove1sBps: numeric("price_move_1s_bps"),
  priceMove10sBps: numeric("price_move_10s_bps"),
  priceMove60sBps: numeric("price_move_60s_bps"),
}).existing();

export const vFillsEdgeHourly = pgView("v_fills_edge_hourly", {
  hour: timestamp("hour", { withTimezone: true }),
  exchange: text("exchange"),
  symbol: text("symbol"),
  fillCount: integer("fill_count"),
  buyCount: integer("buy_count"),
  sellCount: integer("sell_count"),
  totalNotional: numeric("total_notional"),
  edgeT0BpsAvg: numeric("edge_t0_bps_avg"),
  priceMove10sBpsAvg: numeric("price_move_10s_bps_avg"),
  markout10sBpsAvg: numeric("markout_10s_bps_avg"),
  markout60sBpsAvg: numeric("markout_60s_bps_avg"),
  edgeT0BpsVwap: numeric("edge_t0_bps_vwap"),
  priceMove10sBpsVwap: numeric("price_move_10s_bps_vwap"),
  markout10sBpsVwap: numeric("markout_10s_bps_vwap"),
  markout60sBpsVwap: numeric("markout_60s_bps_vwap"),
  edgeT0Usd: numeric("edge_t0_usd"),
  priceMove10sUsd: numeric("price_move_10s_usd"),
  markout10sUsd: numeric("markout_10s_usd"),
  markout60sUsd: numeric("markout_60s_usd"),
  edgeT0BpsNormal: numeric("edge_t0_bps_normal"),
  edgeT0BpsDefensive: numeric("edge_t0_bps_defensive"),
  markout10sBpsNormal: numeric("markout_10s_bps_normal"),
  markout10sBpsDefensive: numeric("markout_10s_bps_defensive"),
}).existing();

export const vFillsEdgeDaily = pgView("v_fills_edge_daily", {
  day: timestamp("day", { withTimezone: true }),
  exchange: text("exchange"),
  symbol: text("symbol"),
  fillCount: integer("fill_count"),
  totalNotional: numeric("total_notional"),
  edgeT0BpsVwap: numeric("edge_t0_bps_vwap"),
  priceMove10sBpsVwap: numeric("price_move_10s_bps_vwap"),
  markout10sBpsVwap: numeric("markout_10s_bps_vwap"),
  markout60sBpsVwap: numeric("markout_60s_bps_vwap"),
  edgeT0Usd: numeric("edge_t0_usd"),
  priceMove10sUsd: numeric("price_move_10s_usd"),
  markout10sUsd: numeric("markout_10s_usd"),
  markout60sUsd: numeric("markout_60s_usd"),
}).existing();

export const vFillsEdgeBySide = pgView("v_fills_edge_by_side", {
  exchange: text("exchange"),
  symbol: text("symbol"),
  side: text("side"),
  fillCount: integer("fill_count"),
  totalNotional: numeric("total_notional"),
  edgeT0BpsAvg: numeric("edge_t0_bps_avg"),
  priceMove10sBpsAvg: numeric("price_move_10s_bps_avg"),
  markout10sBpsAvg: numeric("markout_10s_bps_avg"),
  edgeT0BpsVwap: numeric("edge_t0_bps_vwap"),
  priceMove10sBpsVwap: numeric("price_move_10s_bps_vwap"),
  markout10sBpsVwap: numeric("markout_10s_bps_vwap"),
}).existing();
