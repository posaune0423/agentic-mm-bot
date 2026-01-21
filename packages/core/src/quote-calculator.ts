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

import type { DesiredOrder, Features, Position, PriceStr, RiskEvaluation, StrategyParams } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Internal numeric helpers (keep core pure; avoid NaN/Infinity propagation)
// ─────────────────────────────────────────────────────────────────────────────

function toFiniteNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function nonNegative(n: number): number {
  return n < 0 ? 0 : n;
}

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
  const baseSpread = toFiniteNumber(params.baseHalfSpreadBps, 0);
  const volGain = toFiniteNumber(params.volSpreadGain, 0);
  const toxGain = toFiniteNumber(params.toxSpreadGain, 0);

  const vol = toFiniteNumber(features.realizedVol10s, 0);
  const tox = Math.abs(toFiniteNumber(features.tradeImbalance1s, 0));

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
  const skewGain = toFiniteNumber(params.inventorySkewGain, 0);
  const inventory = toFiniteNumber(position.size, 0);

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
  const current = toFiniteNumber(currentPx, Number.NaN);
  const target = toFiniteNumber(targetPx, Number.NaN);
  const mid = toFiniteNumber(midPx, Number.NaN);

  if (!Number.isFinite(current) || !Number.isFinite(target) || !Number.isFinite(mid) || mid === 0) return true;

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

// ─────────────────────────────────────────────────────────────────────────────
// SET_ORDERS generation (new attack-defense logic)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default values for optional params
 */
const DEFAULT_DEFENSIVE_SPREAD_MULTIPLIER = 1.5;
const DEFAULT_DEFENSIVE_SIZE_MULTIPLIER = 0.5;
const DEFAULT_ONE_SIDED_THRESHOLD = 0.3;
const DEFAULT_UNWIND_TRIGGER_MS = 30_000;
const DEFAULT_UNWIND_SIZE_RATIO = 0.25;

/**
 * Calculate adjusted half spread for defensive mode
 */
function calculateDefensiveHalfSpreadBps(
  baseHalfSpreadBps: number,
  risk: RiskEvaluation,
  defensiveMultiplier: number,
): number {
  if (risk.shouldDefensive) {
    // Apply full defensive multiplier when in defensive mode
    return baseHalfSpreadBps * defensiveMultiplier;
  }
  // Gradually increase spread based on risk score (interpolate)
  const riskAdjustment = 1 + risk.riskScore * (defensiveMultiplier - 1);
  return baseHalfSpreadBps * riskAdjustment;
}

/**
 * Calculate adjusted quote size for defensive mode
 */
function calculateDefensiveSize(baseSizeUsd: number, risk: RiskEvaluation, defensiveSizeMultiplier: number): number {
  if (risk.shouldDefensive) {
    return baseSizeUsd * defensiveSizeMultiplier;
  }
  // Gradually decrease size based on risk score (interpolate)
  const riskAdjustment = 1 - risk.riskScore * (1 - defensiveSizeMultiplier);
  return baseSizeUsd * riskAdjustment;
}

/**
 * Determine if one-sided quoting should be applied
 *
 * @returns 'bid' if only bid should quote, 'ask' if only ask, null if both
 */
function getOneSidedMode(position: Position, params: StrategyParams): "bid" | "ask" | null {
  // Validate and sanitize inputs to avoid forcing single-sided quoting on NaN/out-of-range values
  const posSize = toFiniteNumber(position.size, 0);

  const maxInventory = toFiniteNumber(params.maxInventory, 0);
  if (maxInventory <= 0) return null; // Both sides active when maxInventory is invalid

  const threshold = clamp(
    toFiniteNumber(params.oneSidedThreshold ?? String(DEFAULT_ONE_SIDED_THRESHOLD), DEFAULT_ONE_SIDED_THRESHOLD),
    0,
    1,
  );

  const absPos = Math.abs(posSize);
  const oneSidedLevel = maxInventory * threshold;

  if (absPos <= oneSidedLevel) {
    return null; // Both sides active
  }

  // Long position → stop buying (only ask)
  // Short position → stop selling (only bid)
  return posSize > 0 ? "ask" : "bid";
}

/**
 * Check if unwind order should be generated
 */
function shouldGenerateUnwind(position: Position, params: StrategyParams, nowMs: number): boolean {
  const posSize = toFiniteNumber(position.size, 0);
  if (posSize === 0) return false;

  const positionSinceMs = position.positionSinceMs;
  if (positionSinceMs === undefined) return false;

  const holdingTimeMs = nowMs - positionSinceMs;
  const unwindTriggerMs = params.unwindTriggerMs ?? DEFAULT_UNWIND_TRIGGER_MS;

  return holdingTimeMs >= unwindTriggerMs;
}

/**
 * Calculate unwind order size
 */
function calculateUnwindSize(position: Position, params: StrategyParams): number {
  const posSize = Math.abs(toFiniteNumber(position.size, 0));
  const unwindRatio = clamp(
    toFiniteNumber(params.unwindSizeRatio ?? String(DEFAULT_UNWIND_SIZE_RATIO), DEFAULT_UNWIND_SIZE_RATIO),
    0,
    1,
  );
  return posSize * unwindRatio;
}

/**
 * Generate desired orders for SET_ORDERS intent
 *
 * This implements the attack-defense logic:
 * - Normal: both bid and ask with standard spread/size
 * - Defensive: wider spread, smaller size
 * - One-sided: stop quoting on side that increases inventory
 * - Unwind: add reduce-only IOC to reduce held position
 *
 * @param params - Strategy parameters
 * @param features - Market features
 * @param position - Current position
 * @param risk - Risk evaluation result
 * @param nowMs - Current timestamp for unwind timing
 * @returns Array of desired orders
 */
export function generateDesiredOrders(
  params: StrategyParams,
  features: Features,
  position: Position,
  risk: RiskEvaluation,
  nowMs: number,
): DesiredOrder[] {
  const orders: DesiredOrder[] = [];
  const mid = toFiniteNumber(features.midPx, Number.NaN);

  if (!Number.isFinite(mid) || mid <= 0) {
    return orders; // Invalid mid price, return empty
  }

  // Get defensive multipliers (use defaults if not set)
  const defensiveSpreadMult = Math.max(
    0,
    toFiniteNumber(
      params.defensiveSpreadMultiplier ?? String(DEFAULT_DEFENSIVE_SPREAD_MULTIPLIER),
      DEFAULT_DEFENSIVE_SPREAD_MULTIPLIER,
    ),
  );

  const defensiveSizeMult = Math.max(
    0,
    toFiniteNumber(
      params.defensiveSizeMultiplier ?? String(DEFAULT_DEFENSIVE_SIZE_MULTIPLIER),
      DEFAULT_DEFENSIVE_SIZE_MULTIPLIER,
    ),
  );

  // Calculate base spread
  const baseHalfSpreadBps = nonNegative(toFiniteNumber(calculateHalfSpreadBps(params, features), 0));

  // Apply defensive adjustment to spread
  let adjustedHalfSpreadBps = calculateDefensiveHalfSpreadBps(baseHalfSpreadBps, risk, defensiveSpreadMult);
  if (!Number.isFinite(adjustedHalfSpreadBps)) {
    return []; // Avoid producing NaN quotes
  }
  adjustedHalfSpreadBps = nonNegative(adjustedHalfSpreadBps);

  // Calculate skew
  const skewBps = toFiniteNumber(calculateSkewBps(params, position), 0);

  // Calculate prices
  const halfSpreadPrice = bpsToPrice(mid, adjustedHalfSpreadBps);
  const skewPrice = bpsToPrice(mid, skewBps);

  if (!Number.isFinite(halfSpreadPrice) || !Number.isFinite(skewPrice)) {
    return []; // Avoid producing NaN quotes
  }

  const bidPxNum = mid - halfSpreadPrice - skewPrice;
  const askPxNum = mid + halfSpreadPrice - skewPrice;

  if (!Number.isFinite(bidPxNum) || !Number.isFinite(askPxNum) || bidPxNum <= 0 || askPxNum <= 0) {
    return []; // Avoid producing invalid/NaN quotes
  }

  const bidPx = formatPrice(bidPxNum);
  const askPx = formatPrice(askPxNum);

  // Calculate size with defensive adjustment
  const baseSizeUsd = nonNegative(toFiniteNumber(params.quoteSizeUsd, 0));

  let adjustedSizeUsd = calculateDefensiveSize(baseSizeUsd, risk, defensiveSizeMult);
  if (!Number.isFinite(adjustedSizeUsd)) {
    return []; // Avoid producing NaN size / orders
  }
  adjustedSizeUsd = nonNegative(adjustedSizeUsd);

  const size = usdToBaseSize(String(adjustedSizeUsd), features.midPx);
  const sizeNum = toFiniteNumber(size, Number.NaN);
  const shouldGenerateQuotes = adjustedSizeUsd > 0 && Number.isFinite(sizeNum) && sizeNum > 0;

  // Check one-sided mode
  const oneSidedMode = getOneSidedMode(position, params);

  // Build reason codes for quotes
  const quoteReasonCodes = risk.reasonCodes;

  // Generate quote orders based on one-sided mode
  if (shouldGenerateQuotes && oneSidedMode !== "ask") {
    // Generate bid (unless one-sided ask only)
    orders.push({
      side: "buy",
      price: bidPx,
      size,
      postOnly: true,
      reduceOnly: false,
      timeInForce: "GTC",
      kind: "quote",
      reasonCodes: quoteReasonCodes,
    });
  }

  if (shouldGenerateQuotes && oneSidedMode !== "bid") {
    // Generate ask (unless one-sided bid only)
    orders.push({
      side: "sell",
      price: askPx,
      size,
      postOnly: true,
      reduceOnly: false,
      timeInForce: "GTC",
      kind: "quote",
      reasonCodes: quoteReasonCodes,
    });
  }

  // Check if unwind order should be added
  if (shouldGenerateUnwind(position, params, nowMs)) {
    const posSize = toFiniteNumber(position.size, 0);
    const unwindSize = calculateUnwindSize(position, params);

    if (unwindSize > 0) {
      // Unwind opposite to position: long → sell, short → buy
      const unwindSide = posSize > 0 ? "sell" : "buy";
      // Use mid price for IOC (will fill at market or better)
      const unwindPrice = formatPrice(mid);

      orders.push({
        side: unwindSide,
        price: unwindPrice,
        size: unwindSize.toFixed(6),
        postOnly: false, // IOC can take liquidity
        reduceOnly: true,
        timeInForce: "IOC",
        kind: "unwind",
        reasonCodes: ["INVENTORY_LIMIT"], // Mark as inventory-related
      });
    }
  }

  return orders;
}
