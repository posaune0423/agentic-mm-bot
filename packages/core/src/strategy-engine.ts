/**
 * Strategy Engine - Main decision logic
 *
 * Requirements: 4.3, 5.1-5.7, 7.5
 * - State machine: NORMAL → DEFENSIVE → PAUSE
 * - Priority: HARD PAUSE > DEFENSIVE > NORMAL
 * - PAUSE: always CANCEL_ALL, no quotes
 * - PAUSE exit: return to DEFENSIVE (not NORMAL)
 *
 * This module is pure (no I/O, no throw).
 */

import type {
  CancelAllIntent,
  DecideInput,
  DecideOutput,
  OrderIntent,
  ReasonCode,
  StrategyMode,
  StrategyState,
} from "./types";
import { generateQuoteIntent } from "./quote-calculator";
import { calculatePauseUntil, evaluateRisk, isPauseDurationElapsed } from "./risk-policy";

/**
 * Create a CANCEL_ALL intent
 */
function cancelAllIntent(reasonCodes: ReasonCode[]): CancelAllIntent {
  return {
    type: "CANCEL_ALL",
    reasonCodes,
  };
}

/**
 * Determine the next mode based on risk evaluation and current state
 *
 * Requirements: 5.2, 5.6
 * - If shouldPause → PAUSE
 * - If in PAUSE and conditions clear → DEFENSIVE (not NORMAL)
 * - If shouldDefensive → DEFENSIVE
 * - Otherwise → NORMAL
 */
function determineNextMode(
  currentMode: StrategyMode,
  shouldPause: boolean,
  shouldDefensive: boolean,
  pauseDurationElapsed: boolean,
): StrategyMode {
  // PAUSE has highest priority
  if (shouldPause) {
    return "PAUSE";
  }

  // Exiting PAUSE → go to DEFENSIVE first (5.6)
  if (currentMode === "PAUSE") {
    if (!pauseDurationElapsed) {
      return "PAUSE"; // Maintain pause until duration elapsed
    }
    return "DEFENSIVE"; // Exit to DEFENSIVE, not NORMAL
  }

  // DEFENSIVE conditions
  if (shouldDefensive) {
    return "DEFENSIVE";
  }

  // Normal conditions
  return "NORMAL";
}

/**
 * Main strategy decision function
 *
 * Requirements: 4.3, 5.1-5.7, 7.5
 *
 * This is the core decision function that:
 * 1. Evaluates risk conditions
 * 2. Determines next mode
 * 3. Generates appropriate intents (CANCEL_ALL or QUOTE)
 *
 * @param input - Decision input (state, features, params, position)
 * @returns Decision output (next state, intents, reason codes)
 */
export function decide(input: DecideInput): DecideOutput {
  const { nowMs, state, features, params, position } = input;

  // ─────────────────────────────────────────────────────────────────────────
  // Step 1: Evaluate risk conditions
  // ─────────────────────────────────────────────────────────────────────────
  const risk = evaluateRisk(features, position, params);

  // ─────────────────────────────────────────────────────────────────────────
  // Step 2: Determine next mode
  // ─────────────────────────────────────────────────────────────────────────
  const pauseDurationElapsed = isPauseDurationElapsed(state.pauseUntilMs, nowMs);

  const nextMode = determineNextMode(state.mode, risk.shouldPause, risk.shouldDefensive, pauseDurationElapsed);

  // ─────────────────────────────────────────────────────────────────────────
  // Step 3: Build next state
  // ─────────────────────────────────────────────────────────────────────────
  let nextState: StrategyState;

  if (nextMode !== state.mode) {
    // Mode changed
    nextState = {
      mode: nextMode,
      modeSinceMs: nowMs,
      pauseUntilMs: nextMode === "PAUSE" ? calculatePauseUntil(nowMs) : undefined,
      lastQuoteMs: state.lastQuoteMs,
    };
  } else {
    // Mode unchanged
    nextState = {
      ...state,
      // Update pauseUntilMs if entering PAUSE and it wasn't set
      pauseUntilMs:
        nextMode === "PAUSE" && state.pauseUntilMs === undefined ? calculatePauseUntil(nowMs) : state.pauseUntilMs,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 4: Generate intents
  // ─────────────────────────────────────────────────────────────────────────
  const intents: OrderIntent[] = [];
  const allReasonCodes: ReasonCode[] = [...risk.reasonCodes];

  // 7.5: PAUSE → always CANCEL_ALL, no quotes
  if (nextMode === "PAUSE") {
    intents.push(cancelAllIntent(risk.reasonCodes));

    // Check for pause duration not elapsed
    if (!pauseDurationElapsed && state.mode === "PAUSE") {
      allReasonCodes.push("PAUSE_MIN_DURATION");
    }
  } else {
    // NORMAL or DEFENSIVE → generate quote
    // Note: DEFENSIVE might use wider spreads (handled by quote calculator through features)
    const quote = generateQuoteIntent(params, features, position, risk.reasonCodes);
    intents.push(quote);

    // Update last quote time
    nextState = {
      ...nextState,
      lastQuoteMs: nowMs,
    };
  }

  return {
    nextState,
    intents,
    reasonCodes: allReasonCodes,
  };
}

/**
 * Create initial strategy state
 *
 * @param nowMs - Current time
 * @param mode - Initial mode (default: PAUSE for safety)
 * @returns Initial strategy state
 */
export function createInitialState(nowMs: number, mode: StrategyMode = "PAUSE"): StrategyState {
  return {
    mode,
    modeSinceMs: nowMs,
    pauseUntilMs: mode === "PAUSE" ? calculatePauseUntil(nowMs) : undefined,
    lastQuoteMs: undefined,
  };
}
