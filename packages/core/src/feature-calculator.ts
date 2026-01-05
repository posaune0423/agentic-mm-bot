/**
 * Feature Calculator - Pure logic for computing features from market data
 *
 * Requirements: 6.1-6.6
 * - mid, spread, imbalance, vol, mark_index_div, liq_count
 * - Data stale detection
 * - Missing data handling
 *
 * This module is pure (no I/O, no throw).
 */

import type {
  BpsStr,
  Features,
  Ms,
  PriceStr,
  Snapshot,
  StrategyParams,
} from "./types";

/**
 * Trade data for feature calculation
 */
export interface TradeData {
  ts: Ms;
  px: PriceStr;
  sz: PriceStr;
  side?: "buy" | "sell";
  type?: "normal" | "liq" | "delev";
}

/**
 * Mid price snapshot for volatility calculation
 */
export interface MidSnapshot {
  ts: Ms;
  midPx: PriceStr;
}

/**
 * Small value to avoid division by zero
 */
const EPSILON = 1e-10;

/**
 * Format number to string with precision
 */
function formatBps(value: number): BpsStr {
  return value.toFixed(4);
}

/**
 * Calculate mid price
 *
 * Requirements: 6.1
 * mid = (best_bid + best_ask) / 2
 */
export function calculateMid(bestBid: PriceStr, bestAsk: PriceStr): PriceStr {
  const bid = parseFloat(bestBid);
  const ask = parseFloat(bestAsk);
  return ((bid + ask) / 2).toFixed(8);
}

/**
 * Calculate spread in bps
 *
 * Requirements: 6.1
 * spread_bps = (best_ask - best_bid) / mid * 10000
 */
export function calculateSpreadBps(
  bestBid: PriceStr,
  bestAsk: PriceStr,
  midPx: PriceStr,
): BpsStr {
  const bid = parseFloat(bestBid);
  const ask = parseFloat(bestAsk);
  const mid = parseFloat(midPx);

  if (mid === 0) {
    return "0";
  }

  const spreadBps = ((ask - bid) / mid) * 10_000;
  return formatBps(spreadBps);
}

/**
 * Calculate trade imbalance over 1 second
 *
 * Requirements: 6.2
 * trade_imbalance_1s = (buy_volume - sell_volume) / max(total_volume, eps)
 *
 * If side is unknown, infer from price vs mid:
 * - price > mid → buy
 * - price < mid → sell
 *
 * @param trades - Trades in the last 1 second
 * @param midPx - Current mid price for side inference
 * @returns Trade imbalance (-1 to 1)
 */
export function calculateTradeImbalance1s(
  trades: TradeData[],
  midPx: PriceStr,
): BpsStr {
  if (trades.length === 0) {
    return "0";
  }

  const mid = parseFloat(midPx);
  let buyVol = 0;
  let sellVol = 0;

  for (const trade of trades) {
    const sz = parseFloat(trade.sz);
    let side = trade.side;

    // Infer side if unknown
    if (!side) {
      const px = parseFloat(trade.px);
      side = px >= mid ? "buy" : "sell";
    }

    if (side === "buy") {
      buyVol += sz;
    } else {
      sellVol += sz;
    }
  }

  const totalVol = buyVol + sellVol;
  const imbalance = (buyVol - sellVol) / Math.max(totalVol, EPSILON);

  return formatBps(imbalance);
}

/**
 * Calculate realized volatility over 10 seconds
 *
 * Requirements: 6.3
 * realized_vol_10s = std(ln(mid_t / mid_{t-1}))
 *
 * @param midSnapshots - Mid price snapshots over last 10 seconds
 * @returns Realized volatility (annualized would require scaling)
 */
export function calculateRealizedVol10s(midSnapshots: MidSnapshot[]): BpsStr {
  if (midSnapshots.length < 2) {
    return "0";
  }

  // Calculate log returns
  const returns: number[] = [];
  for (let i = 1; i < midSnapshots.length; i++) {
    const prevMid = parseFloat(midSnapshots[i - 1].midPx);
    const currMid = parseFloat(midSnapshots[i].midPx);

    if (prevMid > 0 && currMid > 0) {
      returns.push(Math.log(currMid / prevMid));
    }
  }

  if (returns.length === 0) {
    return "0";
  }

  // Calculate standard deviation
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);

  // Convert to bps (multiply by 10000)
  const volBps = std * 10_000;
  return formatBps(volBps);
}

/**
 * Calculate mark-index divergence in bps
 *
 * Requirements: 6.4
 * mark_index_div_bps = abs(mark - index) / mid * 10000
 *
 * @param markPx - Mark price (optional)
 * @param indexPx - Index price (optional)
 * @param midPx - Mid price for normalization
 * @returns Divergence in bps, or "0" if data unavailable
 */
export function calculateMarkIndexDivBps(
  markPx: PriceStr | undefined,
  indexPx: PriceStr | undefined,
  midPx: PriceStr,
): BpsStr {
  if (!markPx || !indexPx) {
    return "0";
  }

  const mark = parseFloat(markPx);
  const index = parseFloat(indexPx);
  const mid = parseFloat(midPx);

  if (mid === 0) {
    return "0";
  }

  const divBps = (Math.abs(mark - index) / mid) * 10_000;
  return formatBps(divBps);
}

/**
 * Count liquidation trades in last 10 seconds
 *
 * Requirements: 6.5
 * liq_count_10s = count(trades where type ∈ {LIQ, DELEV})
 *
 * @param trades - Trades in the last 10 seconds
 * @returns Count of liquidation trades
 */
export function calculateLiqCount10s(trades: TradeData[]): number {
  return trades.filter((t) => t.type === "liq" || t.type === "delev").length;
}

/**
 * Check if market data is stale
 *
 * Requirements: 5.3
 *
 * @param lastUpdateMs - Last update timestamp
 * @param nowMs - Current timestamp
 * @param staleCancelMs - Stale threshold
 * @returns true if data is stale
 */
export function isDataStale(
  lastUpdateMs: Ms,
  nowMs: Ms,
  staleCancelMs: Ms,
): boolean {
  return nowMs - lastUpdateMs > staleCancelMs;
}

/**
 * Compute all features from market data
 *
 * Requirements: 6.1-6.6
 *
 * @param snapshot - Current market snapshot
 * @param trades1s - Trades in last 1 second
 * @param trades10s - Trades in last 10 seconds
 * @param midSnapshots10s - Mid snapshots in last 10 seconds
 * @param params - Strategy parameters (for stale threshold)
 * @returns Computed features
 */
export function computeFeatures(
  snapshot: Snapshot,
  trades1s: TradeData[],
  trades10s: TradeData[],
  midSnapshots10s: MidSnapshot[],
  params: StrategyParams,
): Features {
  const midPx = calculateMid(snapshot.bestBidPx, snapshot.bestAskPx);
  const spreadBps = calculateSpreadBps(
    snapshot.bestBidPx,
    snapshot.bestAskPx,
    midPx,
  );
  const tradeImbalance1s = calculateTradeImbalance1s(trades1s, midPx);
  const realizedVol10s = calculateRealizedVol10s(midSnapshots10s);
  const markIndexDivBps = calculateMarkIndexDivBps(
    snapshot.markPx,
    snapshot.indexPx,
    midPx,
  );
  const liqCount10s = calculateLiqCount10s(trades10s);
  const dataStale = isDataStale(
    snapshot.lastUpdateMs,
    snapshot.nowMs,
    params.staleCancelMs,
  );

  return {
    midPx,
    spreadBps,
    tradeImbalance1s,
    realizedVol10s,
    markIndexDivBps,
    liqCount10s,
    dataStale,
  };
}
