/**
 * Strategy Engine - Main decision logic
 *
 * Requirements: 4.3, 5.1-5.7, 7.5
 * - State machine: NORMAL → DEFENSIVE → PAUSE
 * - Priority: HARD PAUSE > DEFENSIVE > NORMAL
 * - PAUSE: SET_ORDERS with empty array (or unwind only)
 * - PAUSE exit: return to DEFENSIVE (not NORMAL)
 *
 * This module is pure (no I/O, no throw).
 */

import type {
  DecideInput,
  DecideOutput,
  DesiredOrder,
  ReasonCode,
  SetOrdersIntent,
  StrategyMode,
  StrategyState,
} from "./types";
import { generateDesiredOrders } from "./quote-calculator";
import { calculatePauseUntil, evaluateRisk, isPauseDurationElapsed } from "./risk-policy";

/**
 * Create a SET_ORDERS intent
 */
function setOrdersIntent(orders: DesiredOrder[], reasonCodes: ReasonCode[]): SetOrdersIntent {
  return {
    type: "SET_ORDERS",
    orders,
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
 * 3. Generates SET_ORDERS intent with desired orders
 *
 * The new SET_ORDERS approach:
 * - PAUSE: empty orders array (cancel all)
 * - NORMAL/DEFENSIVE: bid + ask quotes with attack-defense adjustments
 * - May include unwind orders when position held too long
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
  // Step 4: Generate SET_ORDERS intent
  // ─────────────────────────────────────────────────────────────────────────
  const intents: SetOrdersIntent[] = [];
  const allReasonCodes: ReasonCode[] = [...risk.reasonCodes];

  if (nextMode === "PAUSE") {
    // PAUSE: empty orders array (executor will cancel all)
    // But we may still want unwind orders to reduce held position
    const hasPosition = Number.parseFloat(position.size) !== 0;

    if (hasPosition) {
      // Generate unwind-only orders during PAUSE to reduce inventory
      const unwindOrders = generateDesiredOrders(params, features, position, risk, nowMs).filter(
        o => o.kind === "unwind",
      );
      intents.push(setOrdersIntent(unwindOrders, risk.reasonCodes));
    } else {
      // No position, just cancel all
      intents.push(setOrdersIntent([], risk.reasonCodes));
    }

    // Check for pause duration not elapsed
    if (!pauseDurationElapsed && state.mode === "PAUSE") {
      allReasonCodes.push("PAUSE_MIN_DURATION");
    }
  } else {
    // NORMAL or DEFENSIVE → generate desired orders with attack-defense logic
    const desiredOrders = generateDesiredOrders(params, features, position, risk, nowMs);
    intents.push(setOrdersIntent(desiredOrders, risk.reasonCodes));
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
