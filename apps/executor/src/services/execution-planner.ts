/**
 * Execution Planner - Converts intents to execution actions
 *
 * Requirements: 7.7, 7.8
 * - Minimal order updates (diff-based)
 * - refresh_interval_ms and stale_cancel_ms enforcement
 * - min_requote_bps threshold
 */

import type { Ms, OrderIntent, PriceStr, StrategyParams } from "@agentic-mm-bot/core";
import type { TrackedOrder } from "./order-tracker";

/**
 * Execution action types
 */
export type ExecutionAction =
  | { type: "cancel_all" }
  | { type: "cancel"; clientOrderId: string }
  | { type: "place"; side: "buy" | "sell"; price: PriceStr; size: string };

/**
 * Generate a unique client order ID
 */
export function generateClientOrderId(): string {
  return `ord_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

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
function isOrderStale(order: TrackedOrder, nowMs: Ms, staleCancelMs: Ms): boolean {
  return nowMs - order.createdAtMs > staleCancelMs;
}

/**
 * Minimum requote threshold in bps
 */
const MIN_REQUOTE_BPS = 1;

/**
 * Plan execution actions from intent
 *
 * Requirements: 7.7, 7.8
 *
 * @param intent - Order intent from strategy
 * @param currentBid - Current bid order (if any)
 * @param currentAsk - Current ask order (if any)
 * @param lastQuoteMs - Last quote time
 * @param nowMs - Current time
 * @param params - Strategy parameters
 * @param midPx - Current mid price for threshold calculation
 * @returns List of execution actions
 */
export function planExecution(
  intent: OrderIntent,
  currentBid: TrackedOrder | undefined,
  currentAsk: TrackedOrder | undefined,
  lastQuoteMs: Ms | undefined,
  nowMs: Ms,
  params: StrategyParams,
  midPx: PriceStr,
): ExecutionAction[] {
  const actions: ExecutionAction[] = [];

  // Handle CANCEL_ALL intent
  if (intent.type === "CANCEL_ALL") {
    return [{ type: "cancel_all" }];
  }

  // Handle QUOTE intent
  const { bidPx, askPx, size } = intent;

  // Check refresh interval
  const canRefresh = lastQuoteMs === undefined || nowMs - lastQuoteMs >= params.refreshIntervalMs;

  // Process bid side
  if (currentBid) {
    const stale = isOrderStale(currentBid, nowMs, params.staleCancelMs);
    const needsUpdate = priceExceedsThreshold(currentBid.price, bidPx, midPx, MIN_REQUOTE_BPS) && canRefresh;

    if (stale || needsUpdate) {
      actions.push({ type: "cancel", clientOrderId: currentBid.clientOrderId });
      actions.push({ type: "place", side: "buy", price: bidPx, size });
    }
  } else if (canRefresh) {
    actions.push({ type: "place", side: "buy", price: bidPx, size });
  }

  // Process ask side
  if (currentAsk) {
    const stale = isOrderStale(currentAsk, nowMs, params.staleCancelMs);
    const needsUpdate = priceExceedsThreshold(currentAsk.price, askPx, midPx, MIN_REQUOTE_BPS) && canRefresh;

    if (stale || needsUpdate) {
      actions.push({ type: "cancel", clientOrderId: currentAsk.clientOrderId });
      actions.push({ type: "place", side: "sell", price: askPx, size });
    }
  } else if (canRefresh) {
    actions.push({ type: "place", side: "sell", price: askPx, size });
  }

  return actions;
}
