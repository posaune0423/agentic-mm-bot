/**
 * Quote Calculator - Pure logic for quote price calculation
 *
 * Requirements: 7.2, 7.3, 7.4
 * - Half spread calculation with vol and tox adjustments
 * - Inventory skew for position management
 * - 1-level post-only quotes on both sides
 *
 * This module is pure (no I/O, no throw).
 */

import type { Features, Position, PriceStr, QuoteIntent, ReasonCode, StrategyParams } from "./types";

/**
 * Calculate half spread in bps
 *
 * Requirements: 7.2
 * half_spread_bps = base_half_spread_bps
 *                 + vol_spread_gain * realized_vol_10s
 *                 + tox_spread_gain * abs(trade_imbalance_1s)
 *
 * @param params - Strategy parameters
 * @param features - Market features
 * @returns Half spread in bps
 */
export function calculateHalfSpreadBps(params: StrategyParams, features: Features): number {
  const baseSpread = Number.parseFloat(params.baseHalfSpreadBps);
  const volGain = Number.parseFloat(params.volSpreadGain);
  const toxGain = Number.parseFloat(params.toxSpreadGain);

  const vol = Number.parseFloat(features.realizedVol10s);
  const tox = Math.abs(Number.parseFloat(features.tradeImbalance1s));

  return baseSpread + volGain * vol + toxGain * tox;
}

/**
 * Calculate inventory skew in bps
 *
 * Requirements: 7.3
 * skew_bps = inventory_skew_gain * inventory
 *
 * Positive inventory → higher ask, lower bid (discourage buying)
 * Negative inventory → lower ask, higher bid (discourage selling)
 *
 * @param params - Strategy parameters
 * @param position - Current position
 * @returns Skew in bps
 */
export function calculateSkewBps(params: StrategyParams, position: Position): number {
  const skewGain = Number.parseFloat(params.inventorySkewGain);
  const inventory = Number.parseFloat(position.size);

  return skewGain * inventory;
}

/**
 * Convert bps to price offset
 *
 * @param midPx - Mid price
 * @param bps - Basis points
 * @returns Price offset
 */
function bpsToPrice(midPx: number, bps: number): number {
  return (midPx * bps) / 10_000;
}

/**
 * Format price to string with appropriate precision
 *
 * @param price - Price as number
 * @param precision - Decimal places (default 8)
 * @returns Formatted price string
 */
function formatPrice(price: number, precision = 8): PriceStr {
  return price.toFixed(precision);
}

/**
 * Convert USD notional to base size using mid price
 */
function usdToBaseSize(quoteSizeUsd: string, midPx: PriceStr, precision = 6): string {
  const usd = Number.parseFloat(quoteSizeUsd);
  const mid = Number.parseFloat(midPx);

  if (!Number.isFinite(usd) || usd <= 0) return "0";
  if (!Number.isFinite(mid) || mid <= 0) return "0";

  return (usd / mid).toFixed(precision);
}

/**
 * Check if price difference exceeds threshold
 *
 * Used by execution planners to determine if an order update is needed.
 *
 * @param currentPx - Current order price
 * @param targetPx - Target price
 * @param midPx - Current mid price
 * @param thresholdBps - Threshold in basis points
 * @returns True if price difference exceeds threshold
 */
export function priceExceedsThreshold(
  currentPx: PriceStr,
  targetPx: PriceStr,
  midPx: PriceStr,
  thresholdBps: number,
): boolean {
  const current = Number.parseFloat(currentPx);
  const target = Number.parseFloat(targetPx);
  const mid = Number.parseFloat(midPx);

  if (mid === 0) return true;

  const diffBps = (Math.abs(target - current) / mid) * 10_000;
  return diffBps >= thresholdBps;
}

/**
 * Calculate bid and ask prices
 *
 * Requirements: 7.4
 * bid_px = mid - half_spread - skew
 * ask_px = mid + half_spread - skew
 *
 * Note: Skew is subtracted from both to shift the entire quote
 *
 * @param params - Strategy parameters
 * @param features - Market features
 * @param position - Current position
 * @returns Bid and ask prices
 */
export function calculateQuotePrices(
  params: StrategyParams,
  features: Features,
  position: Position,
): { bidPx: PriceStr; askPx: PriceStr } {
  const mid = Number.parseFloat(features.midPx);
  const halfSpreadBps = calculateHalfSpreadBps(params, features);
  const skewBps = calculateSkewBps(params, position);

  const halfSpreadPrice = bpsToPrice(mid, halfSpreadBps);
  const skewPrice = bpsToPrice(mid, skewBps);

  // Skew shifts the quote:
  // - Positive inventory: shift down (discourage buying more)
  // - Negative inventory: shift up (discourage selling more)
  const bidPx = mid - halfSpreadPrice - skewPrice;
  const askPx = mid + halfSpreadPrice - skewPrice;

  return {
    bidPx: formatPrice(bidPx),
    askPx: formatPrice(askPx),
  };
}

/**
 * Generate quote intent
 *
 * Requirements: 7.1-7.4
 *
 * @param params - Strategy parameters
 * @param features - Market features
 * @param position - Current position
 * @param reasonCodes - Reason codes from risk evaluation
 * @returns Quote intent
 */
export function generateQuoteIntent(
  params: StrategyParams,
  features: Features,
  position: Position,
  reasonCodes: ReasonCode[],
): QuoteIntent {
  const { bidPx, askPx } = calculateQuotePrices(params, features, position);

  return {
    type: "QUOTE",
    bidPx,
    askPx,
    size: usdToBaseSize(params.quoteSizeUsd, features.midPx),
    postOnly: true,
    reasonCodes,
  };
}
