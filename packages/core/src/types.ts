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
 * Order kind distinguishes the purpose of an order
 * - quote: standard market-making quote
 * - unwind: position reduction order (reduce-only)
 */
export type OrderKind = "quote" | "unwind";

/**
 * Time in force for orders
 * - GTC: Good Till Cancel (default for post-only quotes)
 * - IOC: Immediate Or Cancel (for unwind orders)
 */
export type TimeInForce = "GTC" | "IOC";

/**
 * A single desired order in the target order set
 *
 * This represents what the strategy wants to have on the order book.
 * The executor will diff against current orders to determine actions.
 */
export interface DesiredOrder {
  /** Order side */
  side: Side;
  /** Target price */
  price: PriceStr;
  /** Order size */
  size: SizeStr;
  /** Post-only flag (true for quotes, false for IOC unwind) */
  postOnly: boolean;
  /** Reduce-only flag (true for unwind orders) */
  reduceOnly: boolean;
  /** Time in force */
  timeInForce: TimeInForce;
  /** Order kind for audit/analysis */
  kind: OrderKind;
  /** Reason codes for this order */
  reasonCodes: ReasonCode[];
}

/**
 * SET_ORDERS intent - the new unified intent type
 *
 * Contains the complete desired order set. The executor diffs
 * this against current orders to generate cancel/place actions.
 *
 * - Empty array means cancel all orders (PAUSE behavior)
 * - Up to 2 quote orders (bid + ask) + optional unwind order
 */
export interface SetOrdersIntent {
  type: "SET_ORDERS";
  /** Desired orders to maintain on the order book */
  orders: DesiredOrder[];
  /** Aggregate reason codes for this decision */
  reasonCodes: ReasonCode[];
}

/**
 * Strategy outputs a single unified intent type: SET_ORDERS.
 *
 * - Empty orders array means "cancel all"
 * - Orders may include quotes and/or unwind IOC
 */
export type OrderIntent = SetOrdersIntent;

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
  /** Timestamp when position last changed from zero (for unwind timing) */
  positionSinceMs?: Ms;
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Parameters
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strategy parameters (extended for attack-defense)
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

  /** Quote size in USD (notional) */
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

  // ─────────────────────────────────────────────────────────────────────────
  // Attack-Defense Parameters (new)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Defensive spread multiplier (applied when shouldDefensive=true)
   * e.g., 1.5 means spread is 1.5x wider in defensive mode
   * Default: "1.5"
   */
  defensiveSpreadMultiplier?: BpsStr;

  /**
   * Defensive size multiplier (applied when shouldDefensive=true)
   * e.g., 0.5 means quote size is halved in defensive mode
   * Default: "0.5"
   */
  defensiveSizeMultiplier?: BpsStr;

  /**
   * One-sided threshold: start one-sided quoting when inventory exceeds this ratio of maxInventory
   * e.g., 0.3 means start one-sided when abs(inventory) > 0.3 * maxInventory
   * Default: "0.3"
   */
  oneSidedThreshold?: BpsStr;

  /**
   * Unwind trigger time in ms: start unwind IOC orders when position held longer than this
   * Default: 30000 (30 seconds, based on markout analysis)
   */
  unwindTriggerMs?: Ms;

  /**
   * Unwind size ratio: fraction of position to unwind per IOC order
   * e.g., 0.25 means unwind 25% of position
   * Default: "0.25"
   */
  unwindSizeRatio?: BpsStr;
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
  intents: SetOrdersIntent[];
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
  /**
   * Normalized risk score [0, 1] for dynamic spread/size adjustment
   * 0 = low risk (aggressive quoting)
   * 1 = high risk (defensive quoting)
   */
  riskScore: number;
}
