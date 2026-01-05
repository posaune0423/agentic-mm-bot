/**
 * Core Domain Types
 *
 * Pure type definitions for the strategy engine.
 * No I/O dependencies, no side effects.
 *
 * Requirements: 2.1 (core is pure logic, no DB/HTTP/WS/FS)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Value Objects (branded types to avoid primitive obsession)
// ─────────────────────────────────────────────────────────────────────────────

/** Price as string to avoid floating point issues */
export type PriceStr = string;

/** Size as string to avoid floating point issues */
export type SizeStr = string;

/** Basis points as string */
export type BpsStr = string;

/** Milliseconds */
export type Ms = number;

/** Side of an order */
export type Side = "buy" | "sell";

// ─────────────────────────────────────────────────────────────────────────────
// Strategy State (Requirements: 5.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strategy operating modes
 *
 * Requirements: 5.1
 * - NORMAL: Full quoting with standard spreads
 * - DEFENSIVE: Wider spreads, reduced exposure
 * - PAUSE: No quoting, all orders cancelled
 */
export type StrategyMode = "NORMAL" | "DEFENSIVE" | "PAUSE";

// ─────────────────────────────────────────────────────────────────────────────
// Reason Codes (for audit/learning/testing)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reason codes for state transitions and decisions
 *
 * Used for:
 * - Audit logs
 * - Learning (markout analysis)
 * - Testing assertions
 */
export type ReasonCode =
  | "DATA_STALE" // 5.3: latest_top too old
  | "MARK_INDEX_DIVERGED" // 5.4: mark/index gap too wide
  | "LIQUIDATION_SPIKE" // 5.4: too many liq/delev trades
  | "INVENTORY_LIMIT" // 5.5: position exceeds max
  | "DEFENSIVE_VOL" // volatility triggered defensive
  | "DEFENSIVE_TOX" // toxicity triggered defensive
  | "POST_ONLY_REJECTED" // 7.6: order rejected as taker
  | "PAUSE_MIN_DURATION" // 5.7: pause duration not elapsed
  | "NORMAL_CONDITIONS"; // all conditions normal

// ─────────────────────────────────────────────────────────────────────────────
// Order Intents (output of strategy decision)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cancel all orders intent
 */
export interface CancelAllIntent {
  type: "CANCEL_ALL";
  reasonCodes: ReasonCode[];
}

/**
 * Quote intent (post-only bid and ask)
 */
export interface QuoteIntent {
  type: "QUOTE";
  bidPx: PriceStr;
  askPx: PriceStr;
  size: SizeStr;
  postOnly: true;
  reasonCodes: ReasonCode[];
}

export type OrderIntent = CancelAllIntent | QuoteIntent;

// ─────────────────────────────────────────────────────────────────────────────
// Market Data Snapshot
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Market data snapshot for decision making
 *
 * Requirements: 4.1, 4.6
 */
export interface Snapshot {
  exchange: string;
  symbol: string;
  nowMs: Ms;
  bestBidPx: PriceStr;
  bestBidSz: SizeStr;
  bestAskPx: PriceStr;
  bestAskSz: SizeStr;
  markPx?: PriceStr;
  indexPx?: PriceStr;
  lastUpdateMs: Ms;
}

// ─────────────────────────────────────────────────────────────────────────────
// Features (computed from market data)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computed features for strategy decisions
 *
 * Requirements: 6.1-6.5
 */
export interface Features {
  /** Mid price: (best_bid + best_ask) / 2 */
  midPx: PriceStr;

  /** Spread in bps: (best_ask - best_bid) / mid * 10000 */
  spreadBps: BpsStr;

  /** Trade imbalance 1s: (buy_vol - sell_vol) / max(total_vol, eps) */
  tradeImbalance1s: BpsStr;

  /** Realized volatility 10s: std of ln(mid_t / mid_{t-1}) */
  realizedVol10s: BpsStr;

  /** Mark-Index divergence in bps */
  markIndexDivBps: BpsStr;

  /** Liquidation count in last 10s */
  liqCount10s: number;

  /** Whether data is stale (last update too old) */
  dataStale: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Position
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Current position state
 */
export interface Position {
  /** Position size (positive = long, negative = short) */
  size: SizeStr;
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Parameters
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strategy parameters (10 parameters)
 *
 * Requirements: 7.1
 */
export interface StrategyParams {
  /** Base half spread in bps */
  baseHalfSpreadBps: BpsStr;

  /** Volatility spread gain multiplier */
  volSpreadGain: BpsStr;

  /** Toxicity spread gain multiplier */
  toxSpreadGain: BpsStr;

  /** Quote size in USD (e.g. "10" for $10) */
  quoteSizeUsd: SizeStr;

  /** Minimum interval between quote updates (ms) */
  refreshIntervalMs: Ms;

  /** Cancel stale orders after this duration (ms) */
  staleCancelMs: Ms;

  /** Maximum inventory before PAUSE */
  maxInventory: SizeStr;

  /** Inventory skew gain for quote adjustment */
  inventorySkewGain: BpsStr;

  /** Mark-Index divergence threshold for PAUSE (bps) */
  pauseMarkIndexBps: BpsStr;

  /** Liquidation count threshold for PAUSE */
  pauseLiqCount10s: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy State (internal)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal strategy state
 */
export interface StrategyState {
  mode: StrategyMode;
  modeSinceMs: Ms;
  pauseUntilMs?: Ms;
  lastQuoteMs?: Ms;
}

// ─────────────────────────────────────────────────────────────────────────────
// Decision Input/Output
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input for strategy decision
 */
export interface DecideInput {
  nowMs: Ms;
  state: StrategyState;
  features: Features;
  params: StrategyParams;
  position: Position;
}

/**
 * Output from strategy decision
 */
export interface DecideOutput {
  nextState: StrategyState;
  intents: OrderIntent[];
  reasonCodes: ReasonCode[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk Policy Output
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Risk policy evaluation result
 */
export interface RiskEvaluation {
  shouldPause: boolean;
  shouldDefensive: boolean;
  reasonCodes: ReasonCode[];
}
