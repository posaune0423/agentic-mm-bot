/**
 * packages/core - Pure Strategy Logic
 *
 * This package contains all pure business logic for the MM bot.
 * NO I/O dependencies (DB, HTTP, WS, FS).
 * NO exceptions thrown (uses Result types where needed).
 *
 * Requirements: 2.1
 * - Core is pure logic layer
 * - No direct dependencies on DB/HTTP/WS/FS
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export type {
  // Value objects
  PriceStr,
  SizeStr,
  BpsStr,
  Ms,
  Side,
  // Strategy
  StrategyMode,
  ReasonCode,
  StrategyState,
  StrategyParams,
  // Market data
  Snapshot,
  Features,
  Position,
  // Intents
  OrderIntent,
  CancelAllIntent,
  QuoteIntent,
  // Decision
  DecideInput,
  DecideOutput,
  RiskEvaluation,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Engine
// ─────────────────────────────────────────────────────────────────────────────
export { decide, createInitialState } from "./strategy-engine";

// ─────────────────────────────────────────────────────────────────────────────
// Risk Policy
// ─────────────────────────────────────────────────────────────────────────────
export { evaluateRisk, isPauseDurationElapsed, calculatePauseUntil, PAUSE_MIN_DURATION_MS } from "./risk-policy";

// ─────────────────────────────────────────────────────────────────────────────
// Quote Calculator
// ─────────────────────────────────────────────────────────────────────────────
export {
  calculateHalfSpreadBps,
  calculateSkewBps,
  calculateQuotePrices,
  generateQuoteIntent,
  priceExceedsThreshold,
} from "./quote-calculator";

// ─────────────────────────────────────────────────────────────────────────────
// Feature Calculator
// ─────────────────────────────────────────────────────────────────────────────
export type { TradeData, MidSnapshot } from "./feature-calculator";
export {
  calculateMid,
  calculateSpreadBps,
  calculateTradeImbalance1s,
  calculateRealizedVol10s,
  calculateMarkIndexDivBps,
  calculateLiqCount10s,
  isDataStale,
  computeFeatures,
} from "./feature-calculator";

// ─────────────────────────────────────────────────────────────────────────────
// ParamGate (Future Extension: LLM)
// ─────────────────────────────────────────────────────────────────────────────
export type { ParamProposal, ParamGateResult, RollbackConditions } from "./param-gate";
export { validateProposal, isWithinChangeLimit, isWithinPercentageRange, ALLOWED_PARAM_KEYS } from "./param-gate";
