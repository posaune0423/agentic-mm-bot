/**
 * Action Planner - Convert intents to simulated actions
 *
 * Requirements: 7.7, 7.8
 * - Minimal order updates (diff-based)
 * - refresh_interval_ms and stale_cancel_ms enforcement
 *
 * Simplified version of executor's execution-planner for backtest use.
 */

import type { Ms, OrderIntent, PriceStr, StrategyParams } from "@agentic-mm-bot/core";
import type { SimExecution, SimOrder } from "./sim-execution";

/**
 * Simulated action types
 */
export type SimAction =
  | { type: "cancel_all" }
  | { type: "place_bid"; price: PriceStr; size: string }
  | { type: "place_ask"; price: PriceStr; size: string };

/**
 * Minimum requote threshold in bps
 */
const MIN_REQUOTE_BPS = 1;

/**
 * Check if price difference exceeds threshold
 */
function priceExceedsThreshold(
  currentPx: PriceStr,
  targetPx: PriceStr,
  midPx: PriceStr,
  thresholdBps: number,
): boolean {
  const current = parseFloat(currentPx);
  const target = parseFloat(targetPx);
  const mid = parseFloat(midPx);

  if (mid === 0) return true;

  const diffBps = (Math.abs(target - current) / mid) * 10_000;
  return diffBps >= thresholdBps;
}

/**
 * Check if order is stale
 */
function isOrderStale(order: SimOrder, nowMs: Ms, staleCancelMs: Ms): boolean {
  return nowMs - order.createdAtMs > staleCancelMs;
}

/**
 * Plan actions from intent
 *
 * @param intent - Order intent from strategy
 * @param simExec - Simulated execution state
 * @param lastQuoteMs - Last quote time
 * @param nowMs - Current time
 * @param params - Strategy parameters
 * @param midPx - Current mid price
 * @returns List of simulated actions
 */
export function planSimActions(
  intent: OrderIntent,
  simExec: SimExecution,
  lastQuoteMs: Ms | undefined,
  nowMs: Ms,
  params: StrategyParams,
  midPx: PriceStr,
): SimAction[] {
  const actions: SimAction[] = [];

  // Handle CANCEL_ALL intent
  if (intent.type === "CANCEL_ALL") {
    return [{ type: "cancel_all" }];
  }

  // Handle QUOTE intent
  const { bidPx, askPx, size } = intent;
  const currentBid = simExec.getBidOrder();
  const currentAsk = simExec.getAskOrder();

  // Check refresh interval
  const canRefresh = lastQuoteMs === undefined || nowMs - lastQuoteMs >= params.refreshIntervalMs;

  // Process bid side
  if (currentBid) {
    const stale = isOrderStale(currentBid, nowMs, params.staleCancelMs);
    const needsUpdate = priceExceedsThreshold(currentBid.price, bidPx, midPx, MIN_REQUOTE_BPS) && canRefresh;

    if (stale || needsUpdate) {
      // Cancel existing and place new
      actions.push({ type: "place_bid", price: bidPx, size });
    }
  } else if (canRefresh) {
    actions.push({ type: "place_bid", price: bidPx, size });
  }

  // Process ask side
  if (currentAsk) {
    const stale = isOrderStale(currentAsk, nowMs, params.staleCancelMs);
    const needsUpdate = priceExceedsThreshold(currentAsk.price, askPx, midPx, MIN_REQUOTE_BPS) && canRefresh;

    if (stale || needsUpdate) {
      // Cancel existing and place new
      actions.push({ type: "place_ask", price: askPx, size });
    }
  } else if (canRefresh) {
    actions.push({ type: "place_ask", price: askPx, size });
  }

  return actions;
}

/**
 * Execute simulated actions
 */
export function executeSimActions(actions: SimAction[], simExec: SimExecution, nowMs: Ms): void {
  for (const action of actions) {
    switch (action.type) {
      case "cancel_all":
        simExec.cancelAll();
        break;
      case "place_bid":
        simExec.placeBid(action.price, action.size, nowMs);
        break;
      case "place_ask":
        simExec.placeAsk(action.price, action.size, nowMs);
        break;
    }
  }
}
