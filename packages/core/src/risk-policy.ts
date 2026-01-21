/**
 * Risk Policy - Pure logic for risk evaluation
 *
 * Requirements: 5.2, 8.1, 8.2
 * - Transition priority: HARD PAUSE > DEFENSIVE > NORMAL
 * - All triggers: data_stale, mark/index divergence, liq spike, inventory
 *
 * This module is pure (no I/O, no throw).
 */

import type { Features, Position, ReasonCode, RiskEvaluation, StrategyParams } from "./types";

/**
 * Configuration for pause minimum duration
 *
 * Requirements: 5.7
 */
export const PAUSE_MIN_DURATION_MS = 10_000;

/**
 * Threshold for defensive mode based on volatility
 */
const DEFENSIVE_VOL_THRESHOLD_BPS = "50"; // 0.5%

/**
 * Threshold for defensive mode based on toxicity
 */
const DEFENSIVE_TOX_THRESHOLD = "0.7"; // 70% imbalance

/**
 * Calculate normalized risk score [0, 1]
 *
 * Components:
 * - Volatility contribution (0-0.4)
 * - Toxicity contribution (0-0.4)
 * - Inventory contribution (0-0.2)
 */
function calculateRiskScore(features: Features, position: Position, params: StrategyParams): number {
  const vol = Number.parseFloat(features.realizedVol10s);
  const tox = Math.abs(Number.parseFloat(features.tradeImbalance1s));
  const absPosition = Math.abs(Number.parseFloat(position.size));
  const maxInventory = Number.parseFloat(params.maxInventory);
  const oiShockBps = Math.abs(Number.parseFloat(features.openInterestShockBps ?? "0"));

  // Volatility: normalized by defensive threshold, capped at 1
  const volThreshold = Number.parseFloat(DEFENSIVE_VOL_THRESHOLD_BPS);
  const volScore = Math.min(vol / volThreshold, 1);

  // Toxicity: normalized by defensive threshold, capped at 1
  const toxThreshold = Number.parseFloat(DEFENSIVE_TOX_THRESHOLD);
  const toxScore = Math.min(tox / toxThreshold, 1);

  // Inventory: normalized by maxInventory, capped at 1
  const invScore = maxInventory > 0 ? Math.min(absPosition / maxInventory, 1) : 0;

  // Open interest: optional regime signal (Phase 3 plan)
  // Interpret as relative change in bps over a recent window, normalized by a conservative cap.
  // When absent, oiShockBps=0 and behavior is unchanged.
  const OI_SHOCK_CAP_BPS = 500; // 5% change in the window => full score
  const oiScore = Math.min(oiShockBps / OI_SHOCK_CAP_BPS, 1) * 0.2;

  // Weighted combination (cap to [0, 1])
  return Math.min(volScore * 0.4 + toxScore * 0.4 + invScore * 0.2 + oiScore, 1);
}

/**
 * Evaluate risk conditions and determine required mode
 *
 * Requirements: 5.2-5.6, 8.1-8.2
 *
 * Priority order (highest first):
 * 1. Data stale → PAUSE
 * 2. Mark-Index divergence → PAUSE
 * 3. Liquidation spike → PAUSE
 * 4. Inventory limit → PAUSE
 * 5. High volatility → DEFENSIVE
 * 6. High toxicity → DEFENSIVE
 * 7. Normal conditions → NORMAL
 *
 * @param features - Current market features
 * @param position - Current position
 * @param params - Strategy parameters
 * @returns Risk evaluation result
 */
export function evaluateRisk(features: Features, position: Position, params: StrategyParams): RiskEvaluation {
  const reasonCodes: ReasonCode[] = [];
  let shouldPause = false;
  let shouldDefensive = false;

  // ─────────────────────────────────────────────────────────────────────────
  // HARD PAUSE conditions (Requirements: 5.3-5.5)
  // ─────────────────────────────────────────────────────────────────────────

  // 5.3: Data stale
  if (features.dataStale) {
    shouldPause = true;
    reasonCodes.push("DATA_STALE");
  }

  // 5.4: Mark-Index divergence
  const markIndexDiv = Number.parseFloat(features.markIndexDivBps);
  const pauseMarkIndex = Number.parseFloat(params.pauseMarkIndexBps);
  if (markIndexDiv >= pauseMarkIndex) {
    shouldPause = true;
    reasonCodes.push("MARK_INDEX_DIVERGED");
  }

  // 5.4: Liquidation spike
  if (features.liqCount10s >= params.pauseLiqCount10s) {
    shouldPause = true;
    reasonCodes.push("LIQUIDATION_SPIKE");
  }

  // 5.5: Inventory limit
  const absPosition = Math.abs(Number.parseFloat(position.size));
  const maxInventory = Number.parseFloat(params.maxInventory);
  if (absPosition > maxInventory) {
    shouldPause = true;
    reasonCodes.push("INVENTORY_LIMIT");
  }

  // Calculate risk score (used even if pausing)
  const riskScore = calculateRiskScore(features, position, params);

  // Early return if PAUSE required (highest priority)
  if (shouldPause) {
    return { shouldPause, shouldDefensive: false, reasonCodes, riskScore: 1.0 };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DEFENSIVE conditions
  // ─────────────────────────────────────────────────────────────────────────

  // High volatility
  const vol = Number.parseFloat(features.realizedVol10s);
  if (vol >= Number.parseFloat(DEFENSIVE_VOL_THRESHOLD_BPS)) {
    shouldDefensive = true;
    reasonCodes.push("DEFENSIVE_VOL");
  }

  // High toxicity
  const tox = Math.abs(Number.parseFloat(features.tradeImbalance1s));
  if (tox >= Number.parseFloat(DEFENSIVE_TOX_THRESHOLD)) {
    shouldDefensive = true;
    reasonCodes.push("DEFENSIVE_TOX");
  }

  if (!shouldDefensive && reasonCodes.length === 0) {
    reasonCodes.push("NORMAL_CONDITIONS");
  }

  return { shouldPause, shouldDefensive, reasonCodes, riskScore };
}

/**
 * Check if pause duration has elapsed
 *
 * Requirements: 5.7
 *
 * @param pauseUntilMs - Time until which pause should be maintained
 * @param nowMs - Current time
 * @returns true if pause duration has elapsed
 */
export function isPauseDurationElapsed(pauseUntilMs: number | undefined, nowMs: number): boolean {
  if (pauseUntilMs === undefined) {
    return true;
  }
  return nowMs >= pauseUntilMs;
}

/**
 * Calculate pause end time
 *
 * Requirements: 5.7
 *
 * @param nowMs - Current time
 * @returns Time at which pause can be lifted
 */
export function calculatePauseUntil(nowMs: number): number {
  return nowMs + PAUSE_MIN_DURATION_MS;
}
