/**
 * Status Dashboard Script
 *
 * TUI dashboard focused on bot-improvement KPIs from Database.
 *
 * Notes:
 * - This dashboard intentionally avoids “runtime monitoring” (e.g., current position)
 *   and instead highlights summary KPIs, profitability, fill quality, and trends.
 *
 * Usage: bun run status
 *
 * Environment variables:
 * - DATABASE_URL: PostgreSQL connection string
 * - EXCHANGE: Exchange identifier (default: extended)
 * - SYMBOL: Trading symbol (e.g., BTC-USD)
 */

import { sql } from "drizzle-orm";

import { getDb } from "@agentic-mm-bot/db";
import type { Db } from "@agentic-mm-bot/db";
import { BOX, LayoutPolicy, LogBuffer, LogLevel, logger, Style, TTYRenderer, TTYScreen } from "@agentic-mm-bot/utils";
import type { LogRecord } from "@agentic-mm-bot/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration (from env)
// ─────────────────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const EXCHANGE = process.env.EXCHANGE ?? "extended";
const SYMBOL = process.env.SYMBOL ?? "BTC-USD";

// Dashboard config
const RENDER_INTERVAL_MS = 250;
const DB_FETCH_INTERVAL_MS = 10_000;
const TREND_WINDOW_HOURS = 48;
const MIN_CHART_WIDTH = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface DbPerformanceWindow {
  fillCount: number;
  buyCount: number;
  sellCount: number;
  totalNotional: number | null;
  edgeT0Usd: number | null;
  priceMove10sUsd: number | null;
  priceMove60sUsd: number | null;
  markout10sUsd: number | null;
  markout60sUsd: number | null;
  edgeT0BpsVwap: number | null;
  priceMove10sBpsVwap: number | null;
  markout10sBpsVwap: number | null;
  markout60sBpsVwap: number | null;
  // Win rate
  winCount: number;
  winRate: number | null;
  // Avg fill size
  avgFillSize: number | null;
  // Fees
  totalFees: number | null;
  // Net after fees
  netAfterFees: number | null;
}

interface DbBySide {
  side: string;
  fillCount: number;
  totalNotional: number | null;
  edgeT0BpsVwap: number | null;
  priceMove10sBpsVwap: number | null;
  markout10sBpsVwap: number | null;
  edgeT0Usd: number | null;
  markout10sUsd: number | null;
}

interface DbQuality {
  markout10sP10: number | null;
  markout10sP50: number | null;
  markout10sP90: number | null;
  worstFills: Array<{
    fillId: string;
    side: string;
    markout10sBps: number | null;
    fillSz: string;
  }>;
  bestFills: Array<{
    fillId: string;
    side: string;
    markout10sBps: number | null;
    fillSz: string;
  }>;
}

interface DbOps {
  cancelCount: number;
  pauseCount: number;
  orderCount: number;
  fillRate: number | null;
  feeSum: number | null;
  makerRate: number | null;
  takerRate: number | null;
  lastFillTs: Date | null;
  lastOrderEventTs: Date | null;
}

interface DbAllTime {
  fillCount: number;
  totalNotional: number | null;
  edgeT0Usd: number | null;
  priceMove10sUsd: number | null;
  markout10sUsd: number | null;
  totalFees: number | null;
  netAfterFees: number | null;
  firstFillTs: Date | null;
  lastFillTs: Date | null;
}

interface DbTrendPoint {
  hour: Date;
  fillCount: number;
  totalNotional: number | null;
  edgeT0Usd: number | null;
  markout10sUsd: number | null;
  edgeT0BpsVwap: number | null;
  markout10sBpsVwap: number | null;
}

interface DbData {
  perf1h?: DbPerformanceWindow;
  perf24h?: DbPerformanceWindow;
  perf7d?: DbPerformanceWindow;
  allTime?: DbAllTime;
  bySide1h?: DbBySide[];
  quality1h?: DbQuality;
  ops1h?: DbOps;
  trend?: DbTrendPoint[];
  lastFetchMs?: number;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Global State
// ─────────────────────────────────────────────────────────────────────────────

let dbData: DbData = {};
let lastDbFetchMs = 0;
let isFetchingDb = false;

const style = new Style();
const layout = new LayoutPolicy();
const logs = new LogBuffer(100);

const screen = new TTYScreen({
  enabled: process.stdout.isTTY ?? false,
  write: chunk => process.stdout.write(chunk),
});
const renderer = new TTYRenderer(chunk => process.stdout.write(chunk));

let db: Db | null = null;
let startedAtMs = Date.now();

// ─────────────────────────────────────────────────────────────────────────────
// DB Data Fetcher
// ─────────────────────────────────────────────────────────────────────────────

interface PerfQueryRow extends Record<string, unknown> {
  fill_count: string;
  buy_count: string;
  sell_count: string;
  total_notional: string | null;
  edge_t0_usd: string | null;
  price_move_10s_usd: string | null;
  price_move_60s_usd: string | null;
  markout_10s_usd: string | null;
  markout_60s_usd: string | null;
  edge_t0_bps_vwap: string | null;
  price_move_10s_bps_vwap: string | null;
  markout_10s_bps_vwap: string | null;
  markout_60s_bps_vwap: string | null;
  win_count: string;
  avg_fill_size: string | null;
  total_fees: string | null;
}

interface TrendQueryRow extends Record<string, unknown> {
  hour: string;
  fill_count: string;
  total_notional: string | null;
  edge_t0_usd: string | null;
  markout_10s_usd: string | null;
  edge_t0_bps_vwap: string | null;
  markout_10s_bps_vwap: string | null;
}

function parsePerfRow(row: PerfQueryRow | undefined): DbPerformanceWindow {
  const fillCount = Number(row?.fill_count ?? "0");
  const edgeT0Usd = row?.edge_t0_usd ? Number(row.edge_t0_usd) : null;
  const markout10sUsd = row?.markout_10s_usd ? Number(row.markout_10s_usd) : null;
  const totalFees = row?.total_fees ? Number(row.total_fees) : null;
  const winCount = Number(row?.win_count ?? "0");

  return {
    fillCount,
    buyCount: Number(row?.buy_count ?? "0"),
    sellCount: Number(row?.sell_count ?? "0"),
    totalNotional: row?.total_notional ? Number(row.total_notional) : null,
    edgeT0Usd,
    priceMove10sUsd: row?.price_move_10s_usd ? Number(row.price_move_10s_usd) : null,
    priceMove60sUsd: row?.price_move_60s_usd ? Number(row.price_move_60s_usd) : null,
    markout10sUsd,
    markout60sUsd: row?.markout_60s_usd ? Number(row.markout_60s_usd) : null,
    edgeT0BpsVwap: row?.edge_t0_bps_vwap ? Number(row.edge_t0_bps_vwap) : null,
    priceMove10sBpsVwap: row?.price_move_10s_bps_vwap ? Number(row.price_move_10s_bps_vwap) : null,
    markout10sBpsVwap: row?.markout_10s_bps_vwap ? Number(row.markout_10s_bps_vwap) : null,
    markout60sBpsVwap: row?.markout_60s_bps_vwap ? Number(row.markout_60s_bps_vwap) : null,
    winCount,
    winRate: fillCount > 0 ? (winCount / fillCount) * 100 : null,
    avgFillSize: row?.avg_fill_size ? Number(row.avg_fill_size) : null,
    totalFees,
    netAfterFees: markout10sUsd !== null && totalFees !== null ? markout10sUsd - totalFees : markout10sUsd,
  };
}

function parseDbTs(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

function computeRetentionPct(edgeUsd: number | null, netUsd: number | null): number | null {
  if (edgeUsd === null || netUsd === null) return null;
  if (!Number.isFinite(edgeUsd) || !Number.isFinite(netUsd) || edgeUsd === 0) return null;
  return (netUsd / edgeUsd) * 100;
}

async function fetchDbData(): Promise<void> {
  if (!db) {
    dbData = { error: "DB not connected" };
    return;
  }

  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const trendSince = new Date(now.getTime() - TREND_WINDOW_HOURS * 60 * 60 * 1000);

    // Comprehensive performance query helper
    const perfQuery = (since: Date) => sql`
      SELECT
        COALESCE(SUM(fill_count), 0)::text as fill_count,
        COALESCE(SUM(buy_count), 0)::text as buy_count,
        COALESCE(SUM(sell_count), 0)::text as sell_count,
        SUM(total_notional)::text as total_notional,
        SUM(edge_t0_usd)::text as edge_t0_usd,
        SUM(price_move_10s_usd)::text as price_move_10s_usd,
        SUM(markout_60s_usd - markout_10s_usd)::text as price_move_60s_usd,
        SUM(markout_10s_usd)::text as markout_10s_usd,
        SUM(markout_60s_usd)::text as markout_60s_usd,
        CASE WHEN SUM(total_notional) > 0
          THEN (SUM(edge_t0_bps_vwap * total_notional) / SUM(total_notional))::text
          ELSE NULL
        END as edge_t0_bps_vwap,
        CASE WHEN SUM(total_notional) > 0
          THEN (SUM(price_move_10s_bps_vwap * total_notional) / SUM(total_notional))::text
          ELSE NULL
        END as price_move_10s_bps_vwap,
        CASE WHEN SUM(total_notional) > 0
          THEN (SUM(markout_10s_bps_vwap * total_notional) / SUM(total_notional))::text
          ELSE NULL
        END as markout_10s_bps_vwap,
        CASE WHEN SUM(total_notional) > 0
          THEN (SUM(markout_60s_bps_vwap * total_notional) / SUM(total_notional))::text
          ELSE NULL
        END as markout_60s_bps_vwap,
        (SELECT COUNT(*) FROM fills_enriched
         WHERE exchange = ${EXCHANGE} AND symbol = ${SYMBOL}
         AND ts >= ${since} AND markout_10s_bps IS NOT NULL AND markout_10s_bps > 0)::text as win_count,
        CASE WHEN SUM(fill_count) > 0
          THEN (SUM(total_notional) / SUM(fill_count))::text
          ELSE NULL
        END as avg_fill_size,
        (SELECT SUM(CAST(fee AS NUMERIC)) FROM ex_fill
         WHERE exchange = ${EXCHANGE} AND symbol = ${SYMBOL}
         AND ts >= ${since} AND fee IS NOT NULL)::text as total_fees
      FROM v_fills_edge_hourly
      WHERE exchange = ${EXCHANGE}
        AND symbol = ${SYMBOL}
        AND hour >= ${since}
    `;

    // Fetch performance for different time windows
    const [perf1hResult, perf24hResult, perf7dResult] = await Promise.all([
      db.execute<PerfQueryRow>(perfQuery(oneHourAgo)),
      db.execute<PerfQueryRow>(perfQuery(twentyFourHoursAgo)),
      db.execute<PerfQueryRow>(perfQuery(sevenDaysAgo)),
    ]);

    // Fetch trends (hourly time series)
    const trendResult = await db.execute<TrendQueryRow>(sql`
      SELECT
        hour::text as hour,
        COALESCE(SUM(fill_count), 0)::text as fill_count,
        SUM(total_notional)::text as total_notional,
        SUM(edge_t0_usd)::text as edge_t0_usd,
        SUM(markout_10s_usd)::text as markout_10s_usd,
        CASE WHEN SUM(total_notional) > 0
          THEN (SUM(edge_t0_bps_vwap * total_notional) / SUM(total_notional))::text
          ELSE NULL
        END as edge_t0_bps_vwap,
        CASE WHEN SUM(total_notional) > 0
          THEN (SUM(markout_10s_bps_vwap * total_notional) / SUM(total_notional))::text
          ELSE NULL
        END as markout_10s_bps_vwap
      FROM v_fills_edge_hourly
      WHERE exchange = ${EXCHANGE}
        AND symbol = ${SYMBOL}
        AND hour >= ${trendSince}
      GROUP BY hour
      ORDER BY hour ASC
    `);

    // Fetch all-time totals
    const allTimeResult = await db.execute<{
      fill_count: string;
      total_notional: string | null;
      edge_t0_usd: string | null;
      price_move_10s_usd: string | null;
      markout_10s_usd: string | null;
      total_fees: string | null;
      first_fill_ts: string | null;
      last_fill_ts: string | null;
    }>(sql`
      SELECT
        COUNT(*)::text as fill_count,
        SUM(notional_t0)::text as total_notional,
        SUM(edge_t0_bps * notional_t0 / 10000)::text as edge_t0_usd,
        SUM(price_move_10s_bps * notional_t0 / 10000)::text as price_move_10s_usd,
        SUM(markout_10s_bps * notional_t0 / 10000)::text as markout_10s_usd,
        (SELECT SUM(CAST(fee AS NUMERIC)) FROM ex_fill
         WHERE exchange = ${EXCHANGE} AND symbol = ${SYMBOL} AND fee IS NOT NULL)::text as total_fees,
        MIN(ts)::text as first_fill_ts,
        MAX(ts)::text as last_fill_ts
      FROM v_fills_edge_decomposition
      WHERE exchange = ${EXCHANGE}
        AND symbol = ${SYMBOL}
        AND notional_t0 IS NOT NULL AND notional_t0 > 0
    `);
    const at = allTimeResult.rows[0];

    // Fetch by-side analysis (1h)
    const bySideResult = await db.execute<{
      side: string;
      fill_count: string;
      total_notional: string | null;
      edge_t0_bps_vwap: string | null;
      price_move_10s_bps_vwap: string | null;
      markout_10s_bps_vwap: string | null;
      edge_t0_usd: string | null;
      markout_10s_usd: string | null;
    }>(sql`
      SELECT
        UPPER(side) as side,
        COUNT(*)::text as fill_count,
        SUM(notional_t0)::text as total_notional,
        CASE WHEN SUM(notional_t0) > 0
          THEN (SUM(edge_t0_bps * notional_t0) / SUM(notional_t0))::text
          ELSE NULL
        END as edge_t0_bps_vwap,
        CASE WHEN SUM(notional_t0) > 0
          THEN (SUM(price_move_10s_bps * notional_t0) / SUM(notional_t0))::text
          ELSE NULL
        END as price_move_10s_bps_vwap,
        CASE WHEN SUM(notional_t0) > 0
          THEN (SUM(markout_10s_bps * notional_t0) / SUM(notional_t0))::text
          ELSE NULL
        END as markout_10s_bps_vwap,
        SUM(edge_t0_bps * notional_t0 / 10000)::text as edge_t0_usd,
        SUM(markout_10s_bps * notional_t0 / 10000)::text as markout_10s_usd
      FROM v_fills_edge_decomposition
      WHERE exchange = ${EXCHANGE}
        AND symbol = ${SYMBOL}
        AND ts >= ${oneHourAgo}
        AND notional_t0 IS NOT NULL AND notional_t0 > 0
      GROUP BY UPPER(side)
    `);

    // Fetch markout percentiles (1h)
    const percentilesResult = await db.execute<{
      p10: string | null;
      p50: string | null;
      p90: string | null;
    }>(sql`
      SELECT
        PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY CAST(markout_10s_bps AS FLOAT))::text as p10,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CAST(markout_10s_bps AS FLOAT))::text as p50,
        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY CAST(markout_10s_bps AS FLOAT))::text as p90
      FROM fills_enriched
      WHERE exchange = ${EXCHANGE}
        AND symbol = ${SYMBOL}
        AND ts >= ${oneHourAgo}
        AND markout_10s_bps IS NOT NULL
    `);
    const pctl = percentilesResult.rows[0];

    // Fetch worst fills (1h, top 3)
    const worstFillsResult = await db.execute<{
      fill_id: string;
      side: string;
      markout_10s_bps: string | null;
      fill_sz: string;
    }>(sql`
      SELECT
        fill_id::text as fill_id,
        side,
        markout_10s_bps::text as markout_10s_bps,
        fill_sz::text as fill_sz
      FROM fills_enriched
      WHERE exchange = ${EXCHANGE}
        AND symbol = ${SYMBOL}
        AND ts >= ${oneHourAgo}
        AND markout_10s_bps IS NOT NULL
      ORDER BY markout_10s_bps ASC
      LIMIT 3
    `);

    // Fetch best fills (1h, top 3)
    const bestFillsResult = await db.execute<{
      fill_id: string;
      side: string;
      markout_10s_bps: string | null;
      fill_sz: string;
    }>(sql`
      SELECT
        fill_id::text as fill_id,
        side,
        markout_10s_bps::text as markout_10s_bps,
        fill_sz::text as fill_sz
      FROM fills_enriched
      WHERE exchange = ${EXCHANGE}
        AND symbol = ${SYMBOL}
        AND ts >= ${oneHourAgo}
        AND markout_10s_bps IS NOT NULL
      ORDER BY markout_10s_bps DESC
      LIMIT 3
    `);

    // Fetch ops stats (1h)
    const opsResult = await db.execute<{
      cancel_count: string;
      pause_count: string;
      order_count: string;
      fill_count: string;
      fee_sum: string | null;
      maker_count: string;
      taker_count: string;
      last_fill_ts: string | null;
      last_order_event_ts: string | null;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM ex_order_event
         WHERE exchange = ${EXCHANGE} AND symbol = ${SYMBOL}
         AND event_type = 'cancel' AND ts >= ${oneHourAgo})::text as cancel_count,
        (SELECT COUNT(*) FROM strategy_state
         WHERE exchange = ${EXCHANGE} AND symbol = ${SYMBOL}
         AND mode = 'PAUSE' AND ts >= ${oneHourAgo})::text as pause_count,
        (SELECT COUNT(*) FROM ex_order_event
         WHERE exchange = ${EXCHANGE} AND symbol = ${SYMBOL}
         AND event_type = 'new' AND ts >= ${oneHourAgo})::text as order_count,
        (SELECT COUNT(*) FROM ex_fill
         WHERE exchange = ${EXCHANGE} AND symbol = ${SYMBOL}
         AND ts >= ${oneHourAgo})::text as fill_count,
        (SELECT SUM(CAST(fee AS NUMERIC)) FROM ex_fill
         WHERE exchange = ${EXCHANGE} AND symbol = ${SYMBOL}
         AND ts >= ${oneHourAgo} AND fee IS NOT NULL)::text as fee_sum,
        (SELECT COUNT(*) FROM ex_fill
         WHERE exchange = ${EXCHANGE} AND symbol = ${SYMBOL}
         AND ts >= ${oneHourAgo} AND liquidity = 'maker')::text as maker_count,
        (SELECT COUNT(*) FROM ex_fill
         WHERE exchange = ${EXCHANGE} AND symbol = ${SYMBOL}
         AND ts >= ${oneHourAgo} AND liquidity = 'taker')::text as taker_count
        ,
        (SELECT MAX(ts) FROM ex_fill
         WHERE exchange = ${EXCHANGE} AND symbol = ${SYMBOL})::text as last_fill_ts,
        (SELECT MAX(ts) FROM ex_order_event
         WHERE exchange = ${EXCHANGE} AND symbol = ${SYMBOL})::text as last_order_event_ts
    `);
    const ops = opsResult.rows[0];
    const orderCount = Number(ops?.order_count ?? "0");
    const fillCount = Number(ops?.fill_count ?? "0");
    const makerCount = Number(ops?.maker_count ?? "0");
    const takerCount = Number(ops?.taker_count ?? "0");
    const totalLiqCount = makerCount + takerCount;

    dbData = {
      perf1h: parsePerfRow(perf1hResult.rows[0]),
      perf24h: parsePerfRow(perf24hResult.rows[0]),
      perf7d: parsePerfRow(perf7dResult.rows[0]),
      allTime: {
        fillCount: Number(at?.fill_count ?? "0"),
        totalNotional: at?.total_notional ? Number(at.total_notional) : null,
        edgeT0Usd: at?.edge_t0_usd ? Number(at.edge_t0_usd) : null,
        priceMove10sUsd: at?.price_move_10s_usd ? Number(at.price_move_10s_usd) : null,
        markout10sUsd: at?.markout_10s_usd ? Number(at.markout_10s_usd) : null,
        totalFees: at?.total_fees ? Number(at.total_fees) : null,
        netAfterFees:
          at?.markout_10s_usd && at?.total_fees ? Number(at.markout_10s_usd) - Number(at.total_fees)
          : at?.markout_10s_usd ? Number(at.markout_10s_usd)
          : null,
        firstFillTs: at?.first_fill_ts ? new Date(at.first_fill_ts) : null,
        lastFillTs: at?.last_fill_ts ? new Date(at.last_fill_ts) : null,
      },
      bySide1h: bySideResult.rows.map(r => ({
        side: r.side,
        fillCount: Number(r.fill_count ?? "0"),
        totalNotional: r.total_notional ? Number(r.total_notional) : null,
        edgeT0BpsVwap: r.edge_t0_bps_vwap ? Number(r.edge_t0_bps_vwap) : null,
        priceMove10sBpsVwap: r.price_move_10s_bps_vwap ? Number(r.price_move_10s_bps_vwap) : null,
        markout10sBpsVwap: r.markout_10s_bps_vwap ? Number(r.markout_10s_bps_vwap) : null,
        edgeT0Usd: r.edge_t0_usd ? Number(r.edge_t0_usd) : null,
        markout10sUsd: r.markout_10s_usd ? Number(r.markout_10s_usd) : null,
      })),
      quality1h: {
        markout10sP10: pctl?.p10 ? Number(pctl.p10) : null,
        markout10sP50: pctl?.p50 ? Number(pctl.p50) : null,
        markout10sP90: pctl?.p90 ? Number(pctl.p90) : null,
        worstFills: worstFillsResult.rows.map(r => ({
          fillId: r.fill_id,
          side: r.side,
          markout10sBps: r.markout_10s_bps ? Number(r.markout_10s_bps) : null,
          fillSz: r.fill_sz,
        })),
        bestFills: bestFillsResult.rows.map(r => ({
          fillId: r.fill_id,
          side: r.side,
          markout10sBps: r.markout_10s_bps ? Number(r.markout_10s_bps) : null,
          fillSz: r.fill_sz,
        })),
      },
      ops1h: {
        cancelCount: Number(ops?.cancel_count ?? "0"),
        pauseCount: Number(ops?.pause_count ?? "0"),
        orderCount,
        fillRate: orderCount > 0 ? (fillCount / orderCount) * 100 : null,
        feeSum: ops?.fee_sum ? Number(ops.fee_sum) : null,
        makerRate: totalLiqCount > 0 ? (makerCount / totalLiqCount) * 100 : null,
        takerRate: totalLiqCount > 0 ? (takerCount / totalLiqCount) * 100 : null,
        lastFillTs: parseDbTs(ops?.last_fill_ts ?? null),
        lastOrderEventTs: parseDbTs(ops?.last_order_event_ts ?? null),
      },
      trend: trendResult.rows.map(r => ({
        hour: new Date(r.hour),
        fillCount: Number(r.fill_count ?? "0"),
        totalNotional: r.total_notional ? Number(r.total_notional) : null,
        edgeT0Usd: r.edge_t0_usd ? Number(r.edge_t0_usd) : null,
        markout10sUsd: r.markout_10s_usd ? Number(r.markout_10s_usd) : null,
        edgeT0BpsVwap: r.edge_t0_bps_vwap ? Number(r.edge_t0_bps_vwap) : null,
        markout10sBpsVwap: r.markout_10s_bps_vwap ? Number(r.markout_10s_bps_vwap) : null,
      })),
      lastFetchMs: Date.now(),
      error: undefined,
    };

    pushLog(LogLevel.DEBUG, "DB data fetched", { fills1h: dbData.perf1h?.fillCount });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    dbData = { ...dbData, error: msg, lastFetchMs: Date.now() };
    pushLog(LogLevel.WARN, `DB fetch error: ${msg}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Log Helper
// ─────────────────────────────────────────────────────────────────────────────

function pushLog(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
  const r: LogRecord = {
    tsMs: Date.now(),
    level,
    message,
    fields: fields ? Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)])) : undefined,
  };
  logs.push(r);
}

// ─────────────────────────────────────────────────────────────────────────────
// Format Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return n.toFixed(digits);
}

function fmtUsd(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${n.toFixed(digits)}`;
}

function fmtBps(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}bps`;
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return `${n.toFixed(digits)}%`;
}

function colorValue(n: number | null | undefined, positive: "green" | "red" = "green"): string {
  if (n === null || n === undefined || Number.isNaN(n)) return style.token("dim");
  if (n > 0) return positive === "green" ? style.token("green") : style.token("red");
  if (n < 0) return positive === "green" ? style.token("red") : style.token("green");
  return style.token("dim");
}

/**
 * Generate ASCII sparkline from values
 * Uses block characters: ▁▂▃▄▅▆▇█
 */
function sparkline(values: number[], width: number): string {
  if (values.length === 0) return "-".repeat(width);

  const chars = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  // Sample values to fit width
  const sampled: number[] = [];
  if (values.length <= width) {
    sampled.push(...values);
  } else {
    const step = values.length / width;
    for (let i = 0; i < width; i++) {
      const idx = Math.min(Math.floor(i * step), values.length - 1);
      sampled.push(values[idx]);
    }
  }

  // Convert to sparkline
  const result = sampled.map(v => {
    if (range === 0) return chars[4]; // Middle if all same
    const normalized = (v - min) / range;
    const idx = Math.min(Math.floor(normalized * chars.length), chars.length - 1);
    return chars[idx];
  });

  // Pad if needed
  while (result.length < width) {
    result.unshift(" ");
  }

  return result.join("");
}

/**
 * Generate ASCII bar chart (horizontal)
 */
function barChart(value: number, maxValue: number, width: number, fill = "█", empty = "░"): string {
  if (maxValue <= 0 || !Number.isFinite(value)) return empty.repeat(width);
  const fillWidth = Math.min(Math.round((Math.abs(value) / maxValue) * width), width);
  return fill.repeat(fillWidth) + empty.repeat(width - fillWidth);
}

// ─────────────────────────────────────────────────────────────────────────────
// Render Sections
// ─────────────────────────────────────────────────────────────────────────────

function boxRow(content: string, width: number): string {
  const innerWidth = Math.max(0, width - 4);
  const visLen = layout.visibleLength(content);
  const finalContent = visLen > innerWidth ? layout.truncate(content, innerWidth) : content;
  const paddedContent = layout.padRight(finalContent, innerWidth);
  return `${BOX.vertical} ${paddedContent} ${BOX.vertical}`;
}

function renderHeader(nowMs: number, width: number): string[] {
  const lines: string[] = [];

  const title = style.wrap("BOT KPI DASHBOARD", "bold", "white");
  const symbol = style.wrap(`${EXCHANGE}/${SYMBOL}`, "bold", "cyan");

  lines.push(layout.sectionHeader(title, width));

  const uptime = layout.formatDurationMs(nowMs - startedAtMs);
  const uptimeLabel = `${style.token("dim")}uptime${style.token("reset")} ${uptime}`;

  // DB status
  const dbAge = dbData.lastFetchMs ? layout.formatAgeMs(nowMs, dbData.lastFetchMs) : "-";
  const dbStatus = dbData.error ? style.badge("DB ERR", "bgRed", "white") : style.badge("DB OK", "bgGreen", "white");

  const row1 = `${symbol}  ${uptimeLabel}`;
  lines.push(boxRow(row1, width));

  const row2 = `${dbStatus} ${style.token("dim")}age:${style.token("reset")}${dbAge}  ${style.wrap("focus: KPIs / profitability / quality", "dim")}`;
  lines.push(boxRow(row2, width));

  lines.push(layout.boxLine(width, "middle"));
  return lines;
}

function renderKpiSummarySection(width: number): string[] {
  const lines: string[] = [];

  const sectionTitle = style.wrap("KPI SUMMARY (DB)", "bold", "magenta");
  lines.push(layout.sectionHeader(sectionTitle, width));

  if (dbData.error) {
    lines.push(boxRow(`${style.wrap("Error:", "red")} ${dbData.error}`, width));
    lines.push(layout.boxLine(width, "middle"));
    return lines;
  }

  const renderKpiRow = (label: string, labelColor: "cyan" | "yellow" | "green", p?: DbPerformanceWindow) => {
    if (!p) return;
    const edge = p.edgeT0Usd;
    const adv = p.priceMove10sUsd;
    const net = p.markout10sUsd;
    const netAf = p.netAfterFees;

    const edgeColor = colorValue(edge);
    const advColor = colorValue(adv, "red");
    const netColor = colorValue(net);
    const nafColor = colorValue(netAf);

    const retention = computeRetentionPct(edge, net);
    const retentionColor =
      retention === null ? style.token("dim")
      : retention >= 50 ? style.token("green")
      : retention >= 25 ? style.token("yellow")
      : style.token("red");

    lines.push(
      boxRow(
        `${style.wrap(label, "bold", labelColor)}  ` +
          `${style.token("dim")}NetAfterFees:${style.token("reset")}${nafColor}${fmtUsd(netAf).padStart(10)}${style.token("reset")}  ` +
          `${style.token("dim")}Edge:${style.token("reset")}${edgeColor}${fmtUsd(edge).padStart(10)}${style.token("reset")}  ` +
          `${style.token("dim")}AdvSel:${style.token("reset")}${advColor}${fmtUsd(adv).padStart(10)}${style.token("reset")}  ` +
          `${style.token("dim")}Net:${style.token("reset")}${netColor}${fmtUsd(net).padStart(10)}${style.token("reset")}`,
        width,
      ),
    );

    lines.push(
      boxRow(
        `     ${style.token("dim")}Retention:${style.token("reset")}${retentionColor}${fmtPct(retention)}${style.token("reset")}  ` +
          `${style.token("dim")}WinRate:${style.token("reset")}${fmtPct(p.winRate)}  ` +
          `${style.token("dim")}AvgFill:${style.token("reset")}${p.avgFillSize ? `$${fmtNum(p.avgFillSize, 0)}` : "-"}  ` +
          `${style.token("dim")}Vol:${style.token("reset")}${p.totalNotional ? `$${fmtNum(p.totalNotional / 1000, 0)}k` : "-"}  ` +
          `${style.token("dim")}Markout:${style.token("reset")}${fmtBps(p.markout10sBpsVwap)}`,
        width,
      ),
    );
  };

  renderKpiRow("1h ", "cyan", dbData.perf1h);
  renderKpiRow("24h", "yellow", dbData.perf24h);
  renderKpiRow("7d ", "green", dbData.perf7d);

  const at = dbData.allTime;
  if (at && at.fillCount > 0) {
    const range =
      at.firstFillTs && at.lastFillTs ?
        `${at.firstFillTs.toLocaleDateString()} - ${at.lastFillTs.toLocaleDateString()}`
      : "-";
    lines.push(
      boxRow(
        `${style.token("dim")}All-time:${style.token("reset")} ${style.wrap(range, "dim")}  ` +
          `${style.token("dim")}Fills:${style.token("reset")} ${style.wrap(String(at.fillCount), "bold")}  ` +
          `${style.token("dim")}NetAfterFees:${style.token("reset")}${colorValue(at.netAfterFees)}${fmtUsd(at.netAfterFees)}${style.token("reset")}`,
        width,
      ),
    );
  }

  lines.push(layout.boxLine(width, "middle"));
  return lines;
}

function renderTrendsSection(width: number): string[] {
  const lines: string[] = [];

  const sectionTitle = style.wrap(`TRENDS (${TREND_WINDOW_HOURS}h, hourly)`, "bold", "blue");
  lines.push(layout.sectionHeader(sectionTitle, width));

  const trend = dbData.trend ?? [];
  if (trend.length === 0) {
    lines.push(boxRow(`${style.token("dim")}No trend data available${style.token("reset")}`, width));
    lines.push(layout.boxLine(width, "middle"));
    return lines;
  }

  const innerWidth = width - 4;
  const rawWidth = innerWidth - 28;
  const chartWidth = Math.max(MIN_CHART_WIDTH, Math.min(rawWidth, 60));

  const markoutUsd = trend.map(p => p.markout10sUsd ?? 0);
  const edgeUsd = trend.map(p => p.edgeT0Usd ?? 0);
  const fills = trend.map(p => p.fillCount);
  const retention = trend.map(p => computeRetentionPct(p.edgeT0Usd, p.markout10sUsd) ?? 0);

  const lastMarkout = markoutUsd[markoutUsd.length - 1] ?? 0;
  const lastEdge = edgeUsd[edgeUsd.length - 1] ?? 0;
  const lastRet = retention[retention.length - 1] ?? 0;
  const lastFills = fills[fills.length - 1] ?? 0;

  lines.push(
    boxRow(
      `${style.token("dim")}Net Markout ($):${style.token("reset")} ${colorValue(lastMarkout)}${sparkline(markoutUsd, chartWidth)}${style.token("reset")}  ` +
        `${style.token("dim")}last:${style.token("reset")} ${fmtUsd(lastMarkout)}`,
      width,
    ),
  );
  lines.push(
    boxRow(
      `${style.token("dim")}Edge ($):       ${style.token("reset")} ${colorValue(lastEdge)}${sparkline(edgeUsd, chartWidth)}${style.token("reset")}  ` +
        `${style.token("dim")}last:${style.token("reset")} ${fmtUsd(lastEdge)}`,
      width,
    ),
  );
  lines.push(
    boxRow(
      `${style.token("dim")}Retention (%):  ${style.token("reset")} ${style.token("cyan")}${sparkline(retention, chartWidth)}${style.token("reset")}  ` +
        `${style.token("dim")}last:${style.token("reset")} ${fmtPct(lastRet)}`,
      width,
    ),
  );
  lines.push(
    boxRow(
      `${style.token("dim")}Fills (count):  ${style.token("reset")} ${style.token("yellow")}${sparkline(fills, chartWidth)}${style.token("reset")}  ` +
        `${style.token("dim")}last:${style.token("reset")} ${String(lastFills)}`,
      width,
    ),
  );

  lines.push(layout.boxLine(width, "middle"));
  return lines;
}

function renderSpreadRevenueSection(width: number): string[] {
  const lines: string[] = [];

  const sectionTitle = style.wrap("ALL-TIME REVENUE BREAKDOWN (DB)", "bold", "green");
  lines.push(layout.sectionHeader(sectionTitle, width));

  if (dbData.error) {
    lines.push(boxRow(`${style.wrap("Error:", "red")} ${dbData.error}`, width));
    lines.push(layout.boxLine(width, "middle"));
    return lines;
  }

  const allTime = dbData.allTime;

  // All-time summary
  if (allTime && allTime.fillCount > 0) {
    const dateRange =
      allTime.firstFillTs && allTime.lastFillTs ?
        `${allTime.firstFillTs.toLocaleDateString()} - ${allTime.lastFillTs.toLocaleDateString()}`
      : "-";

    lines.push(
      boxRow(
        `${style.token("dim")}ALL TIME:${style.token("reset")} ${style.wrap(dateRange, "dim")}  ${style.token("dim")}Fills:${style.token("reset")} ${style.wrap(String(allTime.fillCount), "bold")}`,
        width,
      ),
    );

    // Spread capture breakdown
    const edgeColor = colorValue(allTime.edgeT0Usd);
    const advColor = colorValue(allTime.priceMove10sUsd, "red");
    const netColor = colorValue(allTime.markout10sUsd);
    const feeColor = style.token("yellow");

    lines.push(
      boxRow(
        `  ${style.token("dim")}Spread Captured:${style.token("reset")} ${edgeColor}${fmtUsd(allTime.edgeT0Usd)}${style.token("reset")}  ${style.token("dim")}Adverse Selection:${style.token("reset")} ${advColor}${fmtUsd(allTime.priceMove10sUsd)}${style.token("reset")}`,
        width,
      ),
    );
    lines.push(
      boxRow(
        `  ${style.token("dim")}Net Markout:${style.token("reset")} ${netColor}${fmtUsd(allTime.markout10sUsd)}${style.token("reset")}  ${style.token("dim")}Fees Paid:${style.token("reset")} ${feeColor}${fmtUsd(allTime.totalFees ? -allTime.totalFees : null)}${style.token("reset")}  ${style.token("dim")}Net After Fees:${style.token("reset")} ${colorValue(allTime.netAfterFees)}${fmtUsd(allTime.netAfterFees)}${style.token("reset")}`,
        width,
      ),
    );

    // Revenue efficiency
    if (allTime.edgeT0Usd && allTime.edgeT0Usd > 0) {
      const retentionRate = allTime.markout10sUsd !== null ? (allTime.markout10sUsd / allTime.edgeT0Usd) * 100 : null;
      const advSelectionRate =
        allTime.priceMove10sUsd !== null ? Math.abs(allTime.priceMove10sUsd / allTime.edgeT0Usd) * 100 : null;
      const retColor =
        retentionRate !== null ?
          retentionRate >= 50 ? style.token("green")
          : retentionRate >= 25 ? style.token("yellow")
          : style.token("red")
        : style.token("dim");

      lines.push(
        boxRow(
          `  ${style.token("dim")}Spread Retention:${style.token("reset")} ${retColor}${fmtPct(retentionRate)}${style.token("reset")}  ${style.token("dim")}Adverse Selection %:${style.token("reset")} ${fmtPct(advSelectionRate)}`,
          width,
        ),
      );
    }
  } else {
    lines.push(boxRow(`${style.token("dim")}No fill data available${style.token("reset")}`, width));
  }

  lines.push(layout.boxLine(width, "middle"));
  return lines;
}

function renderPerformanceSection(width: number): string[] {
  const lines: string[] = [];

  const sectionTitle = style.wrap("PERFORMANCE (DB)", "bold", "magenta");
  lines.push(layout.sectionHeader(sectionTitle, width));

  if (dbData.error) {
    lines.push(boxRow(`${style.wrap("Error:", "red")} ${dbData.error}`, width));
    lines.push(layout.boxLine(width, "middle"));
    return lines;
  }

  // Helper to render a performance row
  const renderPerfRow = (label: string, labelColor: string, p: DbPerformanceWindow | undefined) => {
    if (!p) return;

    const edgeColor = colorValue(p.edgeT0Usd);
    const advColor = colorValue(p.priceMove10sUsd, "red");
    const netColor = colorValue(p.markout10sUsd);
    const winColor =
      p.winRate !== null ?
        p.winRate >= 60 ? style.token("green")
        : p.winRate >= 45 ? style.token("yellow")
        : style.token("red")
      : style.token("dim");

    // Row 1: Core metrics
    lines.push(
      boxRow(
        `${style.wrap(label, "bold", labelColor as "cyan" | "yellow" | "green")}  ${style.token("dim")}Fills:${style.token("reset")}${String(p.fillCount).padStart(4)} (B:${p.buyCount} S:${p.sellCount})  ${style.token("dim")}Vol:${style.token("reset")}${p.totalNotional ? `$${fmtNum(p.totalNotional / 1000, 0)}k` : "-"}  ${style.token("dim")}WinRate:${style.token("reset")}${winColor}${fmtPct(p.winRate)}${style.token("reset")}`,
        width,
      ),
    );

    // Row 2: Revenue breakdown
    lines.push(
      boxRow(
        `     ${style.token("dim")}Edge:${style.token("reset")}${edgeColor}${fmtUsd(p.edgeT0Usd).padStart(10)}${style.token("reset")} ${style.token("dim")}(${fmtBps(p.edgeT0BpsVwap)})${style.token("reset")}  ${style.token("dim")}AdvSel:${style.token("reset")}${advColor}${fmtUsd(p.priceMove10sUsd).padStart(10)}${style.token("reset")}  ${style.token("dim")}Net:${style.token("reset")}${netColor}${fmtUsd(p.markout10sUsd).padStart(10)}${style.token("reset")}  ${style.token("dim")}Fees:${style.token("reset")}${fmtUsd(p.totalFees ? -p.totalFees : null)}`,
        width,
      ),
    );
  };

  renderPerfRow("1h ", "cyan", dbData.perf1h);
  renderPerfRow("24h", "yellow", dbData.perf24h);
  renderPerfRow("7d ", "green", dbData.perf7d);

  lines.push(layout.boxLine(width, "middle"));
  return lines;
}

function renderBySideSection(width: number): string[] {
  const lines: string[] = [];

  const sectionTitle = style.wrap("BY SIDE (1h)", "bold", "blue");
  lines.push(layout.sectionHeader(sectionTitle, width));

  const bySide = dbData.bySide1h;
  if (!bySide || bySide.length === 0) {
    lines.push(boxRow(`${style.token("dim")}No data${style.token("reset")}`, width));
    lines.push(layout.boxLine(width, "middle"));
    return lines;
  }

  for (const s of bySide) {
    const sideColor = s.side === "BUY" ? style.token("green") : style.token("red");
    const edgeColor = colorValue(s.edgeT0Usd);
    const netColor = colorValue(s.markout10sUsd);

    lines.push(
      boxRow(
        `${sideColor}${s.side.padEnd(4)}${style.token("reset")} ${style.token("dim")}Fills:${style.token("reset")}${String(s.fillCount).padStart(4)}  ${style.token("dim")}Edge:${style.token("reset")}${edgeColor}${fmtUsd(s.edgeT0Usd).padStart(9)}${style.token("reset")} ${style.token("dim")}(${fmtBps(s.edgeT0BpsVwap)})${style.token("reset")}  ${style.token("dim")}Net:${style.token("reset")}${netColor}${fmtUsd(s.markout10sUsd).padStart(9)}${style.token("reset")} ${style.token("dim")}(${fmtBps(s.markout10sBpsVwap)})${style.token("reset")}`,
        width,
      ),
    );
  }

  lines.push(layout.boxLine(width, "middle"));
  return lines;
}

function renderQualitySection(width: number): string[] {
  const lines: string[] = [];

  const sectionTitle = style.wrap("FILL QUALITY (1h)", "bold", "cyan");
  lines.push(layout.sectionHeader(sectionTitle, width));

  const q = dbData.quality1h;
  if (!q) {
    lines.push(boxRow(`${style.token("dim")}No data${style.token("reset")}`, width));
    lines.push(layout.boxLine(width, "middle"));
    return lines;
  }

  // Percentiles
  const p10Color = colorValue(q.markout10sP10);
  const p50Color = colorValue(q.markout10sP50);
  const p90Color = colorValue(q.markout10sP90);

  lines.push(
    boxRow(
      `${style.token("dim")}Markout10s Distribution:${style.token("reset")} P10=${p10Color}${fmtBps(q.markout10sP10)}${style.token("reset")}  P50=${p50Color}${fmtBps(q.markout10sP50)}${style.token("reset")}  P90=${p90Color}${fmtBps(q.markout10sP90)}${style.token("reset")}`,
      width,
    ),
  );

  // Best and Worst fills side by side
  const formatFill = (f: { fillId: string; side: string; markout10sBps: number | null; fillSz: string }) => {
    const sideStr = f.side.toUpperCase() === "BUY" ? style.wrap("B", "green") : style.wrap("S", "red");
    const mkoColor = colorValue(f.markout10sBps);
    return `${sideStr} ${mkoColor}${fmtBps(f.markout10sBps).padStart(10)}${style.token("reset")} sz=${f.fillSz}`;
  };

  if (q.worstFills.length > 0 || (q.bestFills && q.bestFills.length > 0)) {
    lines.push(
      boxRow(`${style.wrap("Worst Fills:", "red")}                    ${style.wrap("Best Fills:", "green")}`, width),
    );

    const maxRows = Math.max(q.worstFills.length, q.bestFills?.length ?? 0, 3);
    for (let i = 0; i < Math.min(maxRows, 3); i++) {
      const worst = q.worstFills[i];
      const best = q.bestFills?.[i];
      const worstStr = worst ? formatFill(worst) : "".padEnd(25);
      const bestStr = best ? formatFill(best) : "";
      lines.push(boxRow(`  ${worstStr}        ${bestStr}`, width));
    }
  }

  lines.push(layout.boxLine(width, "middle"));
  return lines;
}

function renderOpsSection(width: number): string[] {
  const lines: string[] = [];

  const sectionTitle = style.wrap("OPERATIONS (1h)", "bold", "yellow");
  lines.push(layout.sectionHeader(sectionTitle, width));

  const ops = dbData.ops1h;
  if (!ops) {
    lines.push(boxRow(`${style.token("dim")}No data${style.token("reset")}`, width));
    lines.push(layout.boxLine(width, "middle"));
    return lines;
  }

  // Activity recency (data health)
  const nowMs = Date.now();
  const lastFillAge = ops.lastFillTs ? layout.formatAgeMs(nowMs, ops.lastFillTs.getTime()) : "-";
  const lastEvtAge = ops.lastOrderEventTs ? layout.formatAgeMs(nowMs, ops.lastOrderEventTs.getTime()) : "-";
  lines.push(
    boxRow(
      `${style.token("dim")}Last fill:${style.token("reset")} ${lastFillAge}  ` +
        `${style.token("dim")}Last order event:${style.token("reset")} ${lastEvtAge}`,
      width,
    ),
  );

  // Order statistics
  const orderLabel = `${style.token("dim")}Orders:${style.token("reset")}`;
  const cancelLabel = `${style.token("dim")}Cancels:${style.token("reset")}`;
  const fillRateLabel = `${style.token("dim")}FillRate:${style.token("reset")}`;
  const pauseLabel = `${style.token("dim")}Pauses:${style.token("reset")}`;

  const orderVal = String(ops.orderCount);
  const cancelVal = String(ops.cancelCount);
  const fillRateVal =
    ops.fillRate !== null ?
      style.wrap(
        fmtPct(ops.fillRate),
        ops.fillRate >= 50 ? "green"
        : ops.fillRate >= 25 ? "yellow"
        : "red",
      )
    : "-";
  const pauseVal = ops.pauseCount > 0 ? style.wrap(String(ops.pauseCount), "yellow") : String(ops.pauseCount);

  lines.push(
    boxRow(
      `${orderLabel} ${orderVal}  ${cancelLabel} ${cancelVal}  ${fillRateLabel} ${fillRateVal}  ${pauseLabel} ${pauseVal}`,
      width,
    ),
  );

  // Liquidity and fees
  const feeLabel = `${style.token("dim")}Fees Paid:${style.token("reset")}`;
  const makerLabel = `${style.token("dim")}Maker:${style.token("reset")}`;
  const takerLabel = `${style.token("dim")}Taker:${style.token("reset")}`;

  const feeVal = ops.feeSum !== null ? `$${fmtNum(ops.feeSum)}` : "-";
  const makerVal =
    ops.makerRate !== null ?
      style.wrap(
        fmtPct(ops.makerRate),
        ops.makerRate >= 90 ? "green"
        : ops.makerRate >= 70 ? "yellow"
        : "red",
      )
    : "-";
  const takerVal = ops.takerRate !== null ? fmtPct(ops.takerRate) : "-";

  lines.push(boxRow(`${feeLabel} ${feeVal}  ${makerLabel} ${makerVal}  ${takerLabel} ${takerVal}`, width));

  lines.push(layout.boxLine(width, "middle"));
  return lines;
}

function renderLogsSection(width: number): string[] {
  const lines: string[] = [];

  const sectionTitle = style.wrap("LOGS", "bold", "gray");
  lines.push(layout.sectionHeader(sectionTitle, width));

  const recentLogs = logs.latest(100).slice().reverse().slice(0, 6);

  if (recentLogs.length === 0) {
    lines.push(boxRow(`${style.token("dim")}No logs yet${style.token("reset")}`, width));
  } else {
    for (const r of recentLogs) {
      const time = new Date(r.tsMs).toISOString().slice(11, 19);
      const timeStr = style.token("dim") + time + style.token("reset");

      let levelBadge: string;
      let msgStyle: string = "";

      switch (r.level) {
        case LogLevel.ERROR:
          levelBadge = style.badge("ERR", "bgRed", "white", "bold");
          msgStyle = style.token("red");
          break;
        case LogLevel.WARN:
          levelBadge = style.badge("WRN", "bgYellow", "white", "bold");
          msgStyle = style.token("yellow");
          break;
        case LogLevel.INFO:
          levelBadge = style.wrap("INF", "cyan");
          break;
        case LogLevel.DEBUG:
          levelBadge = style.wrap("DBG", "dim");
          msgStyle = style.token("dim");
          break;
        default:
          levelBadge = style.wrap("LOG", "dim");
      }

      const msgContent = msgStyle ? `${msgStyle}${r.message}${style.token("reset")}` : r.message;
      const fullLine = `${timeStr} ${levelBadge} ${msgContent}`;
      lines.push(boxRow(fullLine, width));
    }
  }

  lines.push(layout.boxLine(width, "bottom"));
  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Render
// ─────────────────────────────────────────────────────────────────────────────

function render(): void {
  const nowMs = Date.now();
  const W = Math.min(layout.getTerminalWidth(), 160);

  const lines: string[] = [];

  lines.push(...renderHeader(nowMs, W));
  lines.push(...renderKpiSummarySection(W));
  lines.push(...renderTrendsSection(W));
  lines.push(...renderSpreadRevenueSection(W));
  lines.push(...renderPerformanceSection(W));
  lines.push(...renderBySideSection(W));
  lines.push(...renderQualitySection(W));
  lines.push(...renderOpsSection(W));
  lines.push(...renderLogsSection(W));

  renderer.render(lines);
}

// ─────────────────────────────────────────────────────────────────────────────
// Init & Main Loop
// ─────────────────────────────────────────────────────────────────────────────

async function init(): Promise<boolean> {
  // Check required env vars
  if (!DATABASE_URL) {
    console.error("ERROR: DATABASE_URL is required");
    return false;
  }

  if (!SYMBOL) {
    console.error("ERROR: SYMBOL is required");
    return false;
  }

  // Initialize DB
  try {
    db = getDb(DATABASE_URL);
    pushLog(LogLevel.INFO, "DB connected");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    pushLog(LogLevel.ERROR, `DB connection failed: ${msg}`);
    dbData = { error: msg };
  }

  return true;
}

async function runDataFetchers(nowMs: number): Promise<void> {
  // Fetch DB data
  if (nowMs - lastDbFetchMs >= DB_FETCH_INTERVAL_MS && db) {
    if (isFetchingDb) return;
    isFetchingDb = true;
    try {
      await fetchDbData();
      lastDbFetchMs = Date.now();
    } finally {
      isFetchingDb = false;
    }
  }
}

async function main(): Promise<void> {
  if (!process.stdout.isTTY) {
    console.error("This dashboard must be run in a TTY (not redirected).");
    process.exit(1);
  }

  const ok = await init();
  if (!ok) {
    process.exit(1);
  }

  startedAtMs = Date.now();

  // Route logs to buffer
  logger.setSink({ write: r => logs.push(r) });

  screen.start();
  renderer.reset();

  pushLog(LogLevel.INFO, "Dashboard started", { exchange: EXCHANGE, symbol: SYMBOL });

  // Initial fetch
  await fetchDbData();
  lastDbFetchMs = Date.now();

  const shutdown = () => {
    clearInterval(loop);
    logger.clearSink();
    screen.stop();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  const loop = setInterval(() => {
    const nowMs = Date.now();
    void runDataFetchers(nowMs);
    render();
  }, RENDER_INTERVAL_MS);
}

await main();
