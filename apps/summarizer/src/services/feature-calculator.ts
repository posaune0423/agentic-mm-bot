/**
 * Feature Calculator Service
 *
 * Requirements: 9.5, 6.2, 6.3, 6.4, 6.5
 * - Calculate features at fill time for fills_enriched
 * - trade_imbalance_1s, realized_vol_10s, mark_index_div_bps, liq_count_10s
 */

import { eq, and, gte, lte, sql, asc, count } from "drizzle-orm";
import { mdBbo, mdTrade, type Db } from "@agentic-mm-bot/db";

/** Small epsilon to avoid division by zero */
const EPS = 1e-10;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureResult {
  tradeImbalance1sT0: string | null;
  realizedVol10sT0: string | null;
  markIndexDivBpsT0: string | null;
  liqCount10sT0: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Trade Imbalance (Requirement 6.2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate trade imbalance over 1s window
 *
 * imbalance = (buy_vol - sell_vol) / max(total_vol, eps)
 * If side is unknown, infer from trade.px vs mid
 */
export async function calculateTradeImbalance1s(
  db: Db,
  exchange: string,
  symbol: string,
  t0: Date,
  midT0: string | null,
): Promise<string | null> {
  if (!midT0) return null;

  const windowStart = new Date(t0.getTime() - 1000);

  const trades = await db
    .select({
      px: mdTrade.px,
      sz: mdTrade.sz,
      side: mdTrade.side,
    })
    .from(mdTrade)
    .where(
      and(
        eq(mdTrade.exchange, exchange),
        eq(mdTrade.symbol, symbol),
        gte(mdTrade.ts, windowStart),
        lte(mdTrade.ts, t0),
      ),
    );

  if (trades.length === 0) return null;

  const mid = parseFloat(midT0);
  let buyVol = 0;
  let sellVol = 0;

  for (const trade of trades) {
    const sz = parseFloat(trade.sz);
    // Use explicit side if available, otherwise infer from price vs mid
    const isBuy = trade.side ? trade.side.toLowerCase() === "buy" : parseFloat(trade.px) >= mid;

    if (isBuy) {
      buyVol += sz;
    } else {
      sellVol += sz;
    }
  }

  const totalVol = buyVol + sellVol;
  const imbalance = (buyVol - sellVol) / Math.max(totalVol, EPS);

  return imbalance.toFixed(6);
}

// ─────────────────────────────────────────────────────────────────────────────
// Liquidation Count (Requirement 6.5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate liquidation count over 10s window
 *
 * Count trades with type in ('liq', 'delev')
 */
export async function calculateLiqCount10s(db: Db, exchange: string, symbol: string, t0: Date): Promise<number> {
  const windowStart = new Date(t0.getTime() - 10_000);

  const result = await db
    .select({ count: count() })
    .from(mdTrade)
    .where(
      and(
        eq(mdTrade.exchange, exchange),
        eq(mdTrade.symbol, symbol),
        gte(mdTrade.ts, windowStart),
        lte(mdTrade.ts, t0),
        sql`LOWER(${mdTrade.type}) IN ('liq', 'delev')`,
      ),
    );

  return result[0]?.count ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mark-Index Divergence (Requirement 6.4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate mark-index divergence in bps
 *
 * div_bps = abs(mark - index) / mid * 10000
 */
export function calculateMarkIndexDivBps(
  markPx: string | null,
  indexPx: string | null,
  midT0: string | null,
): string | null {
  if (!markPx || !indexPx || !midT0) return null;

  const mark = parseFloat(markPx);
  const index = parseFloat(indexPx);
  const mid = parseFloat(midT0);

  if (mid === 0) return null;

  const divBps = (Math.abs(mark - index) / mid) * 10_000;
  return divBps.toFixed(4);
}

// ─────────────────────────────────────────────────────────────────────────────
// Realized Volatility (Requirement 6.3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate realized volatility over 10s window
 *
 * vol = std(ln(mid_t / mid_{t-1})) for mid series in window
 */
export async function calculateRealizedVol10s(
  db: Db,
  exchange: string,
  symbol: string,
  t0: Date,
): Promise<string | null> {
  const windowStart = new Date(t0.getTime() - 10_000);

  // Get BBO records in window, ordered by time
  const bbos = await db
    .select({
      midPx: mdBbo.midPx,
      ts: mdBbo.ts,
    })
    .from(mdBbo)
    .where(and(eq(mdBbo.exchange, exchange), eq(mdBbo.symbol, symbol), gte(mdBbo.ts, windowStart), lte(mdBbo.ts, t0)))
    .orderBy(asc(mdBbo.ts))
    .limit(2000); // Cap to prevent excessive memory

  if (bbos.length < 2) return null;

  // Calculate log returns
  const logReturns: number[] = [];
  for (let i = 1; i < bbos.length; i++) {
    const prevMid = parseFloat(bbos[i - 1].midPx);
    const curMid = parseFloat(bbos[i].midPx);

    if (prevMid > 0 && curMid > 0) {
      logReturns.push(Math.log(curMid / prevMid));
    }
  }

  if (logReturns.length < 2) return null;

  // Calculate standard deviation
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance = logReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (logReturns.length - 1);
  const stdDev = Math.sqrt(variance);

  return stdDev.toFixed(8);
}

// ─────────────────────────────────────────────────────────────────────────────
// Combined Feature Calculation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate all features for a fill
 */
export async function calculateAllFeatures(
  db: Db,
  exchange: string,
  symbol: string,
  t0: Date,
  midT0: string | null,
  markPx: string | null,
  indexPx: string | null,
): Promise<FeatureResult> {
  const [tradeImbalance1sT0, liqCount10sT0, realizedVol10sT0] = await Promise.all([
    calculateTradeImbalance1s(db, exchange, symbol, t0, midT0),
    calculateLiqCount10s(db, exchange, symbol, t0),
    calculateRealizedVol10s(db, exchange, symbol, t0),
  ]);

  const markIndexDivBpsT0 = calculateMarkIndexDivBps(markPx, indexPx, midT0);

  return {
    tradeImbalance1sT0,
    realizedVol10sT0,
    markIndexDivBpsT0,
    liqCount10sT0,
  };
}
