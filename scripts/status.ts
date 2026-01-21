/**
 * Status Dashboard Script
 *
 * TUI dashboard showing bot KPIs from both Extended SDK (live account data)
 * and Database (historical performance metrics).
 *
 * Usage: bun run status
 *
 * Environment variables (same as executor):
 * - DATABASE_URL: PostgreSQL connection string
 * - EXCHANGE: Exchange identifier (default: extended)
 * - SYMBOL: Trading symbol (e.g., BTC-USD)
 * - EXTENDED_NETWORK: testnet | mainnet
 * - EXTENDED_API_KEY: API key
 * - EXTENDED_STARK_PRIVATE_KEY: Stark private key
 * - EXTENDED_STARK_PUBLIC_KEY: Stark public key
 * - EXTENDED_VAULT_ID: Vault ID
 */

import { sql } from "drizzle-orm";
import {
  initWasm,
  MAINNET_CONFIG,
  PerpetualTradingClient,
  StarkPerpetualAccount,
  TESTNET_CONFIG,
} from "extended-typescript-sdk";

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
const EXTENDED_NETWORK = (process.env.EXTENDED_NETWORK ?? "testnet") as "testnet" | "mainnet";
const EXTENDED_API_KEY = process.env.EXTENDED_API_KEY ?? "";
const EXTENDED_STARK_PRIVATE_KEY = process.env.EXTENDED_STARK_PRIVATE_KEY ?? "";
const EXTENDED_STARK_PUBLIC_KEY = process.env.EXTENDED_STARK_PUBLIC_KEY ?? "";
const EXTENDED_VAULT_ID = Number(process.env.EXTENDED_VAULT_ID ?? "0");

// Dashboard config
const RENDER_INTERVAL_MS = 250;
const SDK_FETCH_INTERVAL_MS = 5_000;
const DB_FETCH_INTERVAL_MS = 10_000;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface BalanceData {
  collateralName?: string;
  balance?: string; // Wallet balance
  equity?: string;
  availableForTrade?: string;
  availableForWithdrawal?: string;
  unrealisedPnl?: string;
  initialMargin?: string;
  marginRatio?: string;
  exposure?: string;
  leverage?: string;
  updatedTime?: number;
}

interface PositionData {
  size: string;
  entryPrice?: string;
  unrealizedPnl?: string;
  side?: string;
  markPrice?: string;
  liquidationPrice?: string;
  leverage?: string;
  value?: string;
  margin?: string;
  realisedPnl?: string;
}

interface AccountInfo {
  accountId?: number;
  status?: string;
  l2Vault?: number;
  description?: string;
}

interface PnlDataPoint {
  date: string;
  value: string;
}

interface SdkData {
  accountInfo?: AccountInfo;
  balance?: BalanceData;
  position?: PositionData;
  openOrdersCount?: number;
  pnlHistory?: PnlDataPoint[];
  equityHistory?: PnlDataPoint[];
  lastFetchMs?: number;
  error?: string;
}

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

interface DbData {
  perf1h?: DbPerformanceWindow;
  perf24h?: DbPerformanceWindow;
  perf7d?: DbPerformanceWindow;
  allTime?: DbAllTime;
  bySide1h?: DbBySide[];
  quality1h?: DbQuality;
  ops1h?: DbOps;
  lastFetchMs?: number;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Global State
// ─────────────────────────────────────────────────────────────────────────────

let sdkData: SdkData = {};
let dbData: DbData = {};
let lastSdkFetchMs = 0;
let lastDbFetchMs = 0;

const style = new Style();
const layout = new LayoutPolicy();
const logs = new LogBuffer(100);

const screen = new TTYScreen({
  enabled: process.stdout.isTTY ?? false,
  write: chunk => process.stdout.write(chunk),
});
const renderer = new TTYRenderer(chunk => process.stdout.write(chunk));

let tradingClient: PerpetualTradingClient | null = null;
let db: Db | null = null;
let startedAtMs = Date.now();

// API base URL for direct HTTP calls
const API_BASE_URL =
  EXTENDED_NETWORK === "mainnet" ?
    "https://api.starknet.extended.exchange/api/v1"
  : "https://api.starknet.sepolia.extended.exchange/api/v1";

// ─────────────────────────────────────────────────────────────────────────────
// SDK Data Fetcher
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safely extract a string value from an object
 */
function safeString(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const val = (obj as Record<string, unknown>)[key];
  if (val === null || val === undefined) return undefined;
  if (typeof val === "string") return val;
  if (typeof val === "number") return val.toString();
  if (typeof val === "object" && "toString" in val) {
    return (val as { toString: () => string }).toString();
  }
  return String(val);
}

/**
 * Fetch PnL history directly via HTTP API
 */
async function fetchPnlHistory(accountId: number, interval: string, pnlType: string): Promise<PnlDataPoint[]> {
  try {
    const url = `${API_BASE_URL}/portfolio/charts/pnl?accountId=${accountId}&interval=${interval}&pnlType=${pnlType}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": EXTENDED_API_KEY,
        "User-Agent": "agentic-mm-bot/1.0",
      },
    });

    if (!res.ok) {
      pushLog(LogLevel.DEBUG, `PnL history API returned ${res.status}`);
      return [];
    }

    const json = (await res.json()) as { status?: string; data?: Array<{ date: string; value: string }> };
    if (json.status !== "OK" || !Array.isArray(json.data)) {
      return [];
    }

    return json.data;
  } catch (err) {
    pushLog(LogLevel.DEBUG, `PnL history fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Fetch equity history directly via HTTP API
 */
async function fetchEquityHistory(accountId: number, interval: string): Promise<PnlDataPoint[]> {
  try {
    const url = `${API_BASE_URL}/portfolio/charts/equities?accountId=${accountId}&interval=${interval}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": EXTENDED_API_KEY,
        "User-Agent": "agentic-mm-bot/1.0",
      },
    });

    if (!res.ok) {
      pushLog(LogLevel.DEBUG, `Equity history API returned ${res.status}`);
      return [];
    }

    const json = (await res.json()) as { status?: string; data?: Array<{ date: string; value: string }> };
    if (json.status !== "OK" || !Array.isArray(json.data)) {
      return [];
    }

    return json.data;
  } catch (err) {
    pushLog(LogLevel.DEBUG, `Equity history fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

async function fetchSdkData(): Promise<void> {
  if (!tradingClient) {
    sdkData = { error: "SDK not initialized" };
    return;
  }

  try {
    // Fetch account info to get accountId
    let accountInfo: AccountInfo | undefined;
    try {
      const accountRes = (await tradingClient.account.getAccount()) as unknown as {
        data?: {
          accountId?: number;
          status?: string;
          l2Vault?: number;
          description?: string;
        };
      };
      const acctData = accountRes.data;
      if (acctData) {
        accountInfo = {
          accountId: acctData.accountId,
          status: acctData.status,
          l2Vault: acctData.l2Vault,
          description: acctData.description,
        };
      }
    } catch {
      // Account info is optional
    }

    // Fetch balance with all fields
    const balanceRes = await tradingClient.account.getBalance();
    const balData = balanceRes.data as unknown as Record<string, unknown> | undefined;

    const balance: BalanceData | undefined =
      balData ?
        {
          collateralName: safeString(balData, "collateralName"),
          balance: safeString(balData, "balance"),
          equity: safeString(balData, "equity"),
          availableForTrade: safeString(balData, "availableForTrade"),
          availableForWithdrawal: safeString(balData, "availableForWithdrawal"),
          unrealisedPnl: safeString(balData, "unrealisedPnl"),
          initialMargin: safeString(balData, "initialMargin"),
          marginRatio: safeString(balData, "marginRatio"),
          exposure: safeString(balData, "exposure"),
          leverage: safeString(balData, "leverage"),
          updatedTime: typeof balData.updatedTime === "number" ? balData.updatedTime : undefined,
        }
      : undefined;

    // Fetch positions with all fields
    const positionsRes = await tradingClient.account.getPositions({ marketNames: [SYMBOL] });
    const positions = (positionsRes.data ?? []) as Array<Record<string, unknown>>;
    const rawPos = positions[0];

    let position: PositionData | undefined;
    if (rawPos) {
      const side = safeString(rawPos, "side");
      const sizeRaw = safeString(rawPos, "size") ?? "0";
      const size = side === "SHORT" ? `-${sizeRaw}` : sizeRaw;

      position = {
        size,
        side,
        entryPrice: safeString(rawPos, "openPrice"),
        unrealizedPnl: safeString(rawPos, "unrealisedPnl"),
        markPrice: safeString(rawPos, "markPrice"),
        liquidationPrice: safeString(rawPos, "liquidationPrice"),
        leverage: safeString(rawPos, "leverage"),
        value: safeString(rawPos, "value"),
        margin: safeString(rawPos, "margin"),
        realisedPnl: safeString(rawPos, "realisedPnl"),
      };
    }

    // Fetch open orders count
    const ordersRes = await tradingClient.account.getOpenOrders({ marketNames: [SYMBOL] });
    const orders = ordersRes.data ?? [];

    // Fetch PnL and equity history if we have accountId
    let pnlHistory: PnlDataPoint[] = [];
    let equityHistory: PnlDataPoint[] = [];

    if (accountInfo?.accountId) {
      // Fetch WEEK interval for charts (7 days)
      pnlHistory = await fetchPnlHistory(accountInfo.accountId, "WEEK", "TOTAL_PNL");
      equityHistory = await fetchEquityHistory(accountInfo.accountId, "WEEK");
    }

    sdkData = {
      accountInfo,
      balance,
      position,
      openOrdersCount: orders.length,
      pnlHistory,
      equityHistory,
      lastFetchMs: Date.now(),
      error: undefined,
    };

    pushLog(LogLevel.DEBUG, "SDK data fetched", {
      orders: orders.length,
      pnlHistoryLen: pnlHistory.length,
      equityHistoryLen: equityHistory.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sdkData = { ...sdkData, error: msg, lastFetchMs: Date.now() };
    pushLog(LogLevel.WARN, `SDK fetch error: ${msg}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DB Data Fetcher
// ─────────────────────────────────────────────────────────────────────────────

async function fetchDbData(): Promise<void> {
  if (!db) {
    dbData = { error: "DB not connected" };
    return;
  }

  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Fetch 1h performance from v_fills_edge_hourly
    const perf1hResult = await db.execute<{
      fill_count: string;
      total_notional: string | null;
      edge_t0_usd: string | null;
      price_move_10s_usd: string | null;
      markout_10s_usd: string | null;
      markout_60s_usd: string | null;
      edge_t0_bps_vwap: string | null;
      markout_10s_bps_vwap: string | null;
    }>(sql`
      SELECT
        COALESCE(SUM(fill_count), 0)::text as fill_count,
        SUM(total_notional)::text as total_notional,
        SUM(edge_t0_usd)::text as edge_t0_usd,
        SUM(price_move_10s_usd)::text as price_move_10s_usd,
        SUM(markout_10s_usd)::text as markout_10s_usd,
        SUM(markout_60s_usd)::text as markout_60s_usd,
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
        AND hour >= ${oneHourAgo}
    `);
    const p1h = perf1hResult.rows[0];

    // Fetch 24h performance
    const perf24hResult = await db.execute<{
      fill_count: string;
      total_notional: string | null;
      edge_t0_usd: string | null;
      price_move_10s_usd: string | null;
      markout_10s_usd: string | null;
      markout_60s_usd: string | null;
      edge_t0_bps_vwap: string | null;
      markout_10s_bps_vwap: string | null;
    }>(sql`
      SELECT
        COALESCE(SUM(fill_count), 0)::text as fill_count,
        SUM(total_notional)::text as total_notional,
        SUM(edge_t0_usd)::text as edge_t0_usd,
        SUM(price_move_10s_usd)::text as price_move_10s_usd,
        SUM(markout_10s_usd)::text as markout_10s_usd,
        SUM(markout_60s_usd)::text as markout_60s_usd,
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
        AND hour >= ${twentyFourHoursAgo}
    `);
    const p24h = perf24hResult.rows[0];

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

    // Fetch worst fills (1h, top 5)
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
      LIMIT 5
    `);

    // Fetch ops stats (1h): cancel count, pause count, fees, maker rate
    const opsResult = await db.execute<{
      cancel_count: string;
      pause_count: string;
      fee_sum: string | null;
      maker_rate: string | null;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM ex_order_event
         WHERE exchange = ${EXCHANGE} AND symbol = ${SYMBOL}
         AND event_type = 'cancel' AND ts >= ${oneHourAgo})::text as cancel_count,
        (SELECT COUNT(*) FROM strategy_state
         WHERE exchange = ${EXCHANGE} AND symbol = ${SYMBOL}
         AND mode = 'PAUSE' AND ts >= ${oneHourAgo})::text as pause_count,
        (SELECT SUM(CAST(fee AS NUMERIC)) FROM ex_fill
         WHERE exchange = ${EXCHANGE} AND symbol = ${SYMBOL}
         AND ts >= ${oneHourAgo} AND fee IS NOT NULL)::text as fee_sum,
        (SELECT
          CASE WHEN COUNT(*) > 0
            THEN (COUNT(*) FILTER (WHERE liquidity = 'maker')::numeric / COUNT(*)::numeric * 100)::text
            ELSE NULL
          END
         FROM ex_fill
         WHERE exchange = ${EXCHANGE} AND symbol = ${SYMBOL}
         AND ts >= ${oneHourAgo})::text as maker_rate
    `);
    const ops = opsResult.rows[0];

    dbData = {
      perf1h: {
        fillCount: Number(p1h?.fill_count ?? "0"),
        totalNotional: p1h?.total_notional ? Number(p1h.total_notional) : null,
        edgeT0Usd: p1h?.edge_t0_usd ? Number(p1h.edge_t0_usd) : null,
        priceMove10sUsd: p1h?.price_move_10s_usd ? Number(p1h.price_move_10s_usd) : null,
        markout10sUsd: p1h?.markout_10s_usd ? Number(p1h.markout_10s_usd) : null,
        markout60sUsd: p1h?.markout_60s_usd ? Number(p1h.markout_60s_usd) : null,
        edgeT0BpsVwap: p1h?.edge_t0_bps_vwap ? Number(p1h.edge_t0_bps_vwap) : null,
        markout10sBpsVwap: p1h?.markout_10s_bps_vwap ? Number(p1h.markout_10s_bps_vwap) : null,
      },
      perf24h: {
        fillCount: Number(p24h?.fill_count ?? "0"),
        totalNotional: p24h?.total_notional ? Number(p24h.total_notional) : null,
        edgeT0Usd: p24h?.edge_t0_usd ? Number(p24h.edge_t0_usd) : null,
        priceMove10sUsd: p24h?.price_move_10s_usd ? Number(p24h.price_move_10s_usd) : null,
        markout10sUsd: p24h?.markout_10s_usd ? Number(p24h.markout_10s_usd) : null,
        markout60sUsd: p24h?.markout_60s_usd ? Number(p24h.markout_60s_usd) : null,
        edgeT0BpsVwap: p24h?.edge_t0_bps_vwap ? Number(p24h.edge_t0_bps_vwap) : null,
        markout10sBpsVwap: p24h?.markout_10s_bps_vwap ? Number(p24h.markout_10s_bps_vwap) : null,
      },
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
      },
      ops1h: {
        cancelCount: Number(ops?.cancel_count ?? "0"),
        pauseCount: Number(ops?.pause_count ?? "0"),
        feeSum: ops?.fee_sum ? Number(ops.fee_sum) : null,
        makerRate: ops?.maker_rate ? Number(ops.maker_rate) : null,
      },
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

  const title = style.wrap("STATUS DASHBOARD", "bold", "white");
  const symbol = style.wrap(`${EXCHANGE}/${SYMBOL}`, "bold", "cyan");
  const network = style.badge(
    EXTENDED_NETWORK.toUpperCase(),
    EXTENDED_NETWORK === "mainnet" ? "bgGreen" : "bgYellow",
    "white",
  );

  lines.push(layout.sectionHeader(title, width));

  const uptime = layout.formatDurationMs(nowMs - startedAtMs);
  const uptimeLabel = `${style.token("dim")}uptime${style.token("reset")} ${uptime}`;

  // SDK status
  const sdkAge = sdkData.lastFetchMs ? layout.formatAgeMs(nowMs, sdkData.lastFetchMs) : "-";
  const sdkStatus =
    sdkData.error ? style.badge("SDK ERR", "bgRed", "white") : style.badge("SDK OK", "bgGreen", "white");

  // DB status
  const dbAge = dbData.lastFetchMs ? layout.formatAgeMs(nowMs, dbData.lastFetchMs) : "-";
  const dbStatus = dbData.error ? style.badge("DB ERR", "bgRed", "white") : style.badge("DB OK", "bgGreen", "white");

  const row1 = `${symbol}  ${network}  ${uptimeLabel}`;
  lines.push(boxRow(row1, width));

  const row2 = `${sdkStatus} ${style.token("dim")}age:${style.token("reset")}${sdkAge}  ${dbStatus} ${style.token("dim")}age:${style.token("reset")}${dbAge}`;
  lines.push(boxRow(row2, width));

  lines.push(layout.boxLine(width, "middle"));
  return lines;
}

function renderAccountSection(nowMs: number, width: number): string[] {
  const lines: string[] = [];

  const sectionTitle = style.wrap("ACCOUNT (SDK)", "bold", "blue");
  lines.push(layout.sectionHeader(sectionTitle, width));

  if (sdkData.error) {
    lines.push(boxRow(`${style.wrap("Error:", "red")} ${sdkData.error}`, width));
    lines.push(layout.boxLine(width, "middle"));
    return lines;
  }

  const bal = sdkData.balance;
  const acct = sdkData.accountInfo;

  // Account ID & Status row
  if (acct?.accountId) {
    const statusBadge =
      acct.status === "ACTIVE" ?
        style.badge("ACTIVE", "bgGreen", "white")
      : style.badge(acct.status ?? "-", "bgYellow", "white");
    lines.push(
      boxRow(
        `${style.token("dim")}Account:${style.token("reset")} #${acct.accountId}  ${statusBadge}  ${style.token("dim")}${acct.description ?? ""}${style.token("reset")}`,
        width,
      ),
    );
  }

  // Main balance row: Equity + Balance + Unrealized PnL
  const equityNum = bal?.equity ? Number.parseFloat(bal.equity) : null;
  const walletBalNum = bal?.balance ? Number.parseFloat(bal.balance) : null;
  const uPnlNum = bal?.unrealisedPnl ? Number.parseFloat(bal.unrealisedPnl) : null;

  const equityLabel = `${style.token("dim")}Equity:${style.token("reset")}`;
  const equityVal = equityNum !== null ? style.wrap(`$${fmtNum(equityNum, 2)}`, "bold", "white") : "-";
  const balLabel = `${style.token("dim")}Wallet:${style.token("reset")}`;
  const balVal = walletBalNum !== null ? `$${fmtNum(walletBalNum, 2)}` : "-";
  const uPnlLabel = `${style.token("dim")}Unrealized PnL:${style.token("reset")}`;
  const uPnlColor = colorValue(uPnlNum);
  const uPnlVal = uPnlNum !== null ? `${uPnlColor}${fmtUsd(uPnlNum, 2)}${style.token("reset")}` : "-";

  lines.push(boxRow(`${equityLabel} ${equityVal}  ${balLabel} ${balVal}  ${uPnlLabel} ${uPnlVal}`, width));

  // Available / Margin / Leverage row
  const availTradeNum = bal?.availableForTrade ? Number.parseFloat(bal.availableForTrade) : null;
  const initialMarginNum = bal?.initialMargin ? Number.parseFloat(bal.initialMargin) : null;
  const leverageNum = bal?.leverage ? Number.parseFloat(bal.leverage) : null;
  const marginRatioNum = bal?.marginRatio ? Number.parseFloat(bal.marginRatio) : null;
  const exposureNum = bal?.exposure ? Number.parseFloat(bal.exposure) : null;

  const availLabel = `${style.token("dim")}Avail:${style.token("reset")}`;
  const availVal = availTradeNum !== null ? `$${fmtNum(availTradeNum, 2)}` : "-";
  const marginLabel = `${style.token("dim")}Margin:${style.token("reset")}`;
  const marginVal = initialMarginNum !== null ? `$${fmtNum(initialMarginNum, 2)}` : "-";
  const levLabel = `${style.token("dim")}Leverage:${style.token("reset")}`;
  const levVal =
    leverageNum !== null ?
      style.wrap(
        `${fmtNum(leverageNum, 2)}x`,
        leverageNum > 10 ? "red"
        : leverageNum > 5 ? "yellow"
        : "green",
      )
    : "-";
  const expLabel = `${style.token("dim")}Exposure:${style.token("reset")}`;
  const expVal = exposureNum !== null ? `$${fmtNum(exposureNum, 0)}` : "-";

  lines.push(
    boxRow(
      `${availLabel} ${availVal}  ${marginLabel} ${marginVal}  ${levLabel} ${levVal}  ${expLabel} ${expVal}`,
      width,
    ),
  );

  // Margin ratio bar
  if (marginRatioNum !== null) {
    const mrLabel = `${style.token("dim")}Margin Ratio:${style.token("reset")}`;
    const mrPct = marginRatioNum * 100;
    const mrColor =
      mrPct > 80 ? style.token("red")
      : mrPct > 50 ? style.token("yellow")
      : style.token("green");
    const mrBar = barChart(mrPct, 100, 20, "█", "░");
    lines.push(
      boxRow(
        `${mrLabel} ${mrColor}${fmtPct(mrPct)}${style.token("reset")} ${mrColor}${mrBar}${style.token("reset")}`,
        width,
      ),
    );
  }

  lines.push(layout.boxLine(width, "middle"));

  // Position section
  const posTitle = style.wrap("POSITION", "bold", "cyan");
  lines.push(layout.sectionHeader(posTitle, width));

  const pos = sdkData.position;
  if (pos) {
    const posSize = Number.parseFloat(pos.size);
    const sideLabel =
      posSize > 0 ? style.wrap("LONG", "bold", "green")
      : posSize < 0 ? style.wrap("SHORT", "bold", "red")
      : style.wrap("FLAT", "dim");
    const sizeVal = style.wrap(
      pos.size,
      posSize > 0 ? "green"
      : posSize < 0 ? "red"
      : "dim",
    );
    const entryVal = pos.entryPrice ?? "-";
    const markVal = pos.markPrice ?? "-";

    lines.push(
      boxRow(
        `${sideLabel} ${sizeVal}  ${style.token("dim")}Entry:${style.token("reset")} ${entryVal}  ${style.token("dim")}Mark:${style.token("reset")} ${markVal}`,
        width,
      ),
    );

    // Position PnL row
    const posUPnlNum = pos.unrealizedPnl ? Number.parseFloat(pos.unrealizedPnl) : null;
    const posRPnlNum = pos.realisedPnl ? Number.parseFloat(pos.realisedPnl) : null;
    const posUPnlColor = colorValue(posUPnlNum);
    const posRPnlColor = colorValue(posRPnlNum);
    const liqVal = pos.liquidationPrice ?? "-";
    const posLevVal = pos.leverage ? `${pos.leverage}x` : "-";

    lines.push(
      boxRow(
        `${style.token("dim")}uPnL:${style.token("reset")} ${posUPnlColor}${fmtUsd(posUPnlNum)}${style.token("reset")}  ${style.token("dim")}rPnL:${style.token("reset")} ${posRPnlColor}${fmtUsd(posRPnlNum)}${style.token("reset")}  ${style.token("dim")}Liq:${style.token("reset")} ${liqVal}  ${style.token("dim")}Lev:${style.token("reset")} ${posLevVal}`,
        width,
      ),
    );
  } else {
    lines.push(boxRow(`${style.wrap("NO POSITION", "dim")}`, width));
  }

  // Open orders
  const ordersLabel = `${style.token("dim")}Open Orders:${style.token("reset")}`;
  const ordersVal = sdkData.openOrdersCount !== undefined ? String(sdkData.openOrdersCount) : "-";
  lines.push(boxRow(`${ordersLabel} ${ordersVal}`, width));

  lines.push(layout.boxLine(width, "middle"));
  return lines;
}

function renderPnlChartSection(width: number): string[] {
  const lines: string[] = [];

  const sectionTitle = style.wrap("PNL CHART (7d)", "bold", "green");
  lines.push(layout.sectionHeader(sectionTitle, width));

  const pnlHistory = sdkData.pnlHistory ?? [];
  const equityHistory = sdkData.equityHistory ?? [];

  if (pnlHistory.length === 0 && equityHistory.length === 0) {
    lines.push(boxRow(`${style.token("dim")}No history data available${style.token("reset")}`, width));
    lines.push(layout.boxLine(width, "middle"));
    return lines;
  }

  const innerWidth = width - 4;
  const chartWidth = Math.min(innerWidth - 25, 60);

  // PnL sparkline
  if (pnlHistory.length > 0) {
    const pnlValues = pnlHistory.map(p => Number.parseFloat(p.value));
    const pnlMin = Math.min(...pnlValues);
    const pnlMax = Math.max(...pnlValues);
    const pnlLast = pnlValues[pnlValues.length - 1];
    const pnlChange = pnlValues.length >= 2 ? pnlLast - pnlValues[0] : 0;

    const pnlColor = pnlLast >= 0 ? style.token("green") : style.token("red");
    const changeColor = colorValue(pnlChange);
    const chart = sparkline(pnlValues, chartWidth);

    lines.push(
      boxRow(
        `${style.token("dim")}Total PnL:${style.token("reset")} ${pnlColor}${chart}${style.token("reset")}`,
        width,
      ),
    );
    lines.push(
      boxRow(
        `  ${style.token("dim")}Current:${style.token("reset")} ${pnlColor}${fmtUsd(pnlLast)}${style.token("reset")}  ${style.token("dim")}Change:${style.token("reset")} ${changeColor}${fmtUsd(pnlChange)}${style.token("reset")}  ${style.token("dim")}Min:${style.token("reset")} ${fmtUsd(pnlMin)}  ${style.token("dim")}Max:${style.token("reset")} ${fmtUsd(pnlMax)}`,
        width,
      ),
    );
  }

  // Equity sparkline
  if (equityHistory.length > 0) {
    const eqValues = equityHistory.map(p => Number.parseFloat(p.value));
    const eqMin = Math.min(...eqValues);
    const eqMax = Math.max(...eqValues);
    const eqLast = eqValues[eqValues.length - 1];
    const eqChange = eqValues.length >= 2 ? eqLast - eqValues[0] : 0;

    const eqColor = style.token("cyan");
    const changeColor = colorValue(eqChange);
    const chart = sparkline(eqValues, chartWidth);

    lines.push(boxRow("", width)); // spacer
    lines.push(
      boxRow(`${style.token("dim")}Equity:${style.token("reset")}    ${eqColor}${chart}${style.token("reset")}`, width),
    );
    lines.push(
      boxRow(
        `  ${style.token("dim")}Current:${style.token("reset")} ${eqColor}$${fmtNum(eqLast, 2)}${style.token("reset")}  ${style.token("dim")}Change:${style.token("reset")} ${changeColor}${fmtUsd(eqChange)}${style.token("reset")}  ${style.token("dim")}Min:${style.token("reset")} $${fmtNum(eqMin, 2)}  ${style.token("dim")}Max:${style.token("reset")} $${fmtNum(eqMax, 2)}`,
        width,
      ),
    );
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

  // Header row
  const hdr = `${style.token("dim")}${"".padEnd(8)}  ${"Fills".padStart(6)}  ${"Notional".padStart(10)}  ${"Edge".padStart(10)}  ${"PrcMv".padStart(10)}  ${"M10s".padStart(10)}  ${"M60s".padStart(10)}  ${"Edge(bps)".padStart(10)}  ${"M10s(bps)".padStart(10)}${style.token("reset")}`;
  lines.push(boxRow(hdr, width));

  // 1h row
  const p1h = dbData.perf1h;
  if (p1h) {
    const edgeColor = colorValue(p1h.edgeT0Usd);
    const priceMoveColor = colorValue(p1h.priceMove10sUsd, "red"); // negative is good for price move
    const m10sColor = colorValue(p1h.markout10sUsd);
    const m60sColor = colorValue(p1h.markout60sUsd);

    const row = [
      style.wrap("1h", "bold", "cyan").padEnd(8),
      String(p1h.fillCount).padStart(6),
      (p1h.totalNotional ? `$${fmtNum(p1h.totalNotional, 0)}` : "-").padStart(10),
      `${edgeColor}${fmtUsd(p1h.edgeT0Usd)}${style.token("reset")}`.padStart(10 + 10), // extra for ANSI
      `${priceMoveColor}${fmtUsd(p1h.priceMove10sUsd)}${style.token("reset")}`.padStart(10 + 10),
      `${m10sColor}${fmtUsd(p1h.markout10sUsd)}${style.token("reset")}`.padStart(10 + 10),
      `${m60sColor}${fmtUsd(p1h.markout60sUsd)}${style.token("reset")}`.padStart(10 + 10),
      fmtBps(p1h.edgeT0BpsVwap).padStart(10),
      fmtBps(p1h.markout10sBpsVwap).padStart(10),
    ].join("  ");
    lines.push(boxRow(row, width));
  }

  // 24h row
  const p24h = dbData.perf24h;
  if (p24h) {
    const edgeColor = colorValue(p24h.edgeT0Usd);
    const priceMoveColor = colorValue(p24h.priceMove10sUsd, "red");
    const m10sColor = colorValue(p24h.markout10sUsd);
    const m60sColor = colorValue(p24h.markout60sUsd);

    const row = [
      style.wrap("24h", "bold", "yellow").padEnd(8),
      String(p24h.fillCount).padStart(6),
      (p24h.totalNotional ? `$${fmtNum(p24h.totalNotional, 0)}` : "-").padStart(10),
      `${edgeColor}${fmtUsd(p24h.edgeT0Usd)}${style.token("reset")}`.padStart(10 + 10),
      `${priceMoveColor}${fmtUsd(p24h.priceMove10sUsd)}${style.token("reset")}`.padStart(10 + 10),
      `${m10sColor}${fmtUsd(p24h.markout10sUsd)}${style.token("reset")}`.padStart(10 + 10),
      `${m60sColor}${fmtUsd(p24h.markout60sUsd)}${style.token("reset")}`.padStart(10 + 10),
      fmtBps(p24h.edgeT0BpsVwap).padStart(10),
      fmtBps(p24h.markout10sBpsVwap).padStart(10),
    ].join("  ");
    lines.push(boxRow(row, width));
  }

  lines.push(layout.boxLine(width, "middle"));
  return lines;
}

function renderQualitySection(width: number): string[] {
  const lines: string[] = [];

  const sectionTitle = style.wrap("QUALITY (1h)", "bold", "cyan");
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

  const pctlRow = `${style.token("dim")}Markout10s:${style.token("reset")} P10=${p10Color}${fmtBps(q.markout10sP10)}${style.token("reset")}  P50=${p50Color}${fmtBps(q.markout10sP50)}${style.token("reset")}  P90=${p90Color}${fmtBps(q.markout10sP90)}${style.token("reset")}`;
  lines.push(boxRow(pctlRow, width));

  // Worst fills
  if (q.worstFills.length > 0) {
    lines.push(boxRow(`${style.token("dim")}Worst Fills (by markout):${style.token("reset")}`, width));
    for (const f of q.worstFills.slice(0, 3)) {
      const sideStr = f.side.toUpperCase() === "BUY" ? style.wrap("BUY", "green") : style.wrap("SELL", "red");
      const mkoColor = colorValue(f.markout10sBps);
      const row = `  ${sideStr} sz=${f.fillSz} ${mkoColor}${fmtBps(f.markout10sBps)}${style.token("reset")} id=${f.fillId.slice(0, 8)}...`;
      lines.push(boxRow(row, width));
    }
  }

  lines.push(layout.boxLine(width, "middle"));
  return lines;
}

function renderOpsSection(width: number): string[] {
  const lines: string[] = [];

  const sectionTitle = style.wrap("OPS (1h)", "bold", "yellow");
  lines.push(layout.sectionHeader(sectionTitle, width));

  const ops = dbData.ops1h;
  if (!ops) {
    lines.push(boxRow(`${style.token("dim")}No data${style.token("reset")}`, width));
    lines.push(layout.boxLine(width, "middle"));
    return lines;
  }

  const cancelLabel = `${style.token("dim")}Cancels:${style.token("reset")}`;
  const pauseLabel = `${style.token("dim")}Pauses:${style.token("reset")}`;
  const feeLabel = `${style.token("dim")}Fees:${style.token("reset")}`;
  const makerLabel = `${style.token("dim")}Maker%:${style.token("reset")}`;

  const cancelVal = String(ops.cancelCount);
  const pauseVal = ops.pauseCount > 0 ? style.wrap(String(ops.pauseCount), "yellow") : String(ops.pauseCount);
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

  lines.push(
    boxRow(
      `${cancelLabel} ${cancelVal}  ${pauseLabel} ${pauseVal}  ${feeLabel} ${feeVal}  ${makerLabel} ${makerVal}`,
      width,
    ),
  );

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
  const W = Math.min(layout.getTerminalWidth(), 140);

  const lines: string[] = [];

  lines.push(...renderHeader(nowMs, W));
  lines.push(...renderAccountSection(nowMs, W));
  lines.push(...renderPnlChartSection(W));
  lines.push(...renderPerformanceSection(W));
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

  // Initialize SDK (optional - can run without it)
  if (EXTENDED_API_KEY && EXTENDED_STARK_PRIVATE_KEY && EXTENDED_STARK_PUBLIC_KEY && EXTENDED_VAULT_ID) {
    try {
      await initWasm();

      const starkAccount = new StarkPerpetualAccount(
        EXTENDED_VAULT_ID,
        EXTENDED_STARK_PRIVATE_KEY,
        EXTENDED_STARK_PUBLIC_KEY,
        EXTENDED_API_KEY,
      );

      const endpointConfig = EXTENDED_NETWORK === "mainnet" ? MAINNET_CONFIG : TESTNET_CONFIG;
      tradingClient = new PerpetualTradingClient(endpointConfig, starkAccount);

      pushLog(LogLevel.INFO, "SDK initialized", { network: EXTENDED_NETWORK });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushLog(LogLevel.WARN, `SDK init failed: ${msg}`);
      sdkData = { error: msg };
    }
  } else {
    pushLog(LogLevel.WARN, "SDK credentials not configured - running in DB-only mode");
    sdkData = { error: "SDK credentials not configured" };
  }

  return true;
}

async function runDataFetchers(nowMs: number): Promise<void> {
  // Fetch SDK data
  if (nowMs - lastSdkFetchMs >= SDK_FETCH_INTERVAL_MS && tradingClient) {
    lastSdkFetchMs = nowMs;
    void fetchSdkData();
  }

  // Fetch DB data
  if (nowMs - lastDbFetchMs >= DB_FETCH_INTERVAL_MS && db) {
    lastDbFetchMs = nowMs;
    void fetchDbData();
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
  await fetchSdkData();
  await fetchDbData();
  lastSdkFetchMs = Date.now();
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
