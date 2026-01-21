/**
 * Execution Planner - Converts intents to execution actions
 *
 * Requirements: 7.7, 7.8
 * - Minimal order updates (diff-based)
 * - refresh_interval_ms and stale_cancel_ms enforcement
 * - min_requote_bps threshold
 *
 * Now supports SET_ORDERS intent with diff-based planning.
 */

import type {
  DesiredOrder,
  Ms,
  PriceStr,
  SetOrdersIntent,
  Side,
  StrategyParams,
  TimeInForce,
} from "@agentic-mm-bot/core";
import { priceExceedsThreshold } from "@agentic-mm-bot/core";
import type { TrackedOrder } from "./order-tracker";

/**
 * Execution action types
 */
export type ExecutionAction =
  | { type: "cancel_all" }
  | { type: "cancel"; clientOrderId: string; exchangeOrderId?: string }
  | {
      type: "place";
      side: Side;
      price: PriceStr;
      size: string;
      postOnly: boolean;
      reduceOnly: boolean;
      timeInForce: TimeInForce;
    };

/**
 * Generate a unique client order ID
 */
export function generateClientOrderId(): string {
  return `ord_${String(Date.now())}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Check if order is stale
 */
function isOrderStale(order: TrackedOrder, nowMs: Ms, staleCancelMs: Ms): boolean {
  return nowMs - order.createdAtMs > staleCancelMs;
}

/**
 * Minimum requote threshold in bps (for diff-based updates)
 * Orders with price difference below this threshold are considered "close enough"
 * and won't be updated to reduce POST_ONLY_REJECTED spam.
 */
const MIN_REQUOTE_BPS = 2; // Increased from 1 to reduce unnecessary updates

/**
 * Size difference threshold (as ratio) to trigger update
 * e.g., 0.1 means 10% size difference triggers update
 */
const SIZE_CHANGE_THRESHOLD = 0.1;

/**
 * Check if size difference warrants an update
 */
function sizeNeedsUpdate(currentSize: string, targetSize: string): boolean {
  const current = Number.parseFloat(currentSize);
  const target = Number.parseFloat(targetSize);

  if (current === 0) return target !== 0;
  if (target === 0) return true;

  const ratio = Math.abs(target - current) / current;
  return ratio >= SIZE_CHANGE_THRESHOLD;
}

/**
 * Find matching tracked order for a desired order
 */
function findMatchingOrder(desired: DesiredOrder, currentOrders: TrackedOrder[]): TrackedOrder | undefined {
  // For quote orders, match by side only (one quote per side).
  // For unwind orders, we intentionally do not match (always create new IOC orders).
  if (desired.kind !== "quote") return undefined;
  return currentOrders.find(o => o.side === desired.side);
}

/**
 * Check if current order needs update to match desired
 */
function orderNeedsUpdate(
  current: TrackedOrder,
  desired: DesiredOrder,
  midPx: PriceStr,
  nowMs: Ms,
  params: StrategyParams,
  canRefresh: boolean,
): boolean {
  // Check staleness
  if (isOrderStale(current, nowMs, params.staleCancelMs)) {
    return true;
  }

  // Check price threshold (only if refresh is allowed)
  if (canRefresh && priceExceedsThreshold(current.price, desired.price, midPx, MIN_REQUOTE_BPS)) {
    return true;
  }

  // Check size difference
  if (sizeNeedsUpdate(current.size, desired.size)) {
    return true;
  }

  return false;
}

/**
 * Plan execution actions from SET_ORDERS intent (new diff-based approach)
 *
 * Algorithm:
 * 1. For each desired order, find a matching current order
 * 2. If match found and needs update → cancel + place
 * 3. If match found and no update needed → keep (no action)
 * 4. If no match found → place new order
 * 5. For current orders not matched by any desired → cancel
 *
 * @param desiredOrders - Desired orders from SET_ORDERS intent
 * @param currentOrders - Currently tracked orders
 * @param lastQuoteMs - Last quote time
 * @param nowMs - Current time
 * @param params - Strategy parameters
 * @param midPx - Current mid price for threshold calculation
 * @returns List of execution actions
 */
export function planSetOrdersExecution(
  desiredOrders: DesiredOrder[],
  currentOrders: TrackedOrder[],
  lastQuoteMs: Ms | undefined,
  nowMs: Ms,
  params: StrategyParams,
  midPx: PriceStr,
): ExecutionAction[] {
  const actions: ExecutionAction[] = [];
  const matchedCurrentIds = new Set<string>();

  // Check refresh interval
  // NOTE:
  // - refreshIntervalMs throttles quote *updates* to reduce churn / POST_ONLY_REJECT spam.
  // - If there are no current orders, we must allow placement even if the last quote attempt was recent
  //   (otherwise a single reject/cancel can stall quoting indefinitely).
  const canRefresh =
    currentOrders.length === 0 || lastQuoteMs === undefined || nowMs - lastQuoteMs >= params.refreshIntervalMs;

  // If no desired orders and we have current orders, cancel all
  if (desiredOrders.length === 0 && currentOrders.length > 0) {
    return [{ type: "cancel_all" }];
  }

  // Process each desired order
  for (const desired of desiredOrders) {
    // Unwind orders (IOC) are always placed fresh, never matched
    if (desired.kind === "unwind") {
      actions.push({
        type: "place",
        side: desired.side,
        price: desired.price,
        size: desired.size,
        postOnly: desired.postOnly,
        reduceOnly: desired.reduceOnly,
        timeInForce: desired.timeInForce,
      });
      continue;
    }

    // For quote orders, try to find matching current order
    const matching = findMatchingOrder(desired, currentOrders);

    if (matching) {
      matchedCurrentIds.add(matching.clientOrderId);

      // Check if update is needed
      if (orderNeedsUpdate(matching, desired, midPx, nowMs, params, canRefresh)) {
        // Cancel old, place new
        actions.push({
          type: "cancel",
          clientOrderId: matching.clientOrderId,
          exchangeOrderId: matching.exchangeOrderId,
        });
        actions.push({
          type: "place",
          side: desired.side,
          price: desired.price,
          size: desired.size,
          postOnly: desired.postOnly,
          reduceOnly: desired.reduceOnly,
          timeInForce: desired.timeInForce,
        });
      }
      // else: order is good, no action needed
    } else if (canRefresh) {
      // No matching order, place new
      actions.push({
        type: "place",
        side: desired.side,
        price: desired.price,
        size: desired.size,
        postOnly: desired.postOnly,
        reduceOnly: desired.reduceOnly,
        timeInForce: desired.timeInForce,
      });
    }
  }

  // Cancel current orders that weren't matched by any desired order
  for (const current of currentOrders) {
    if (!matchedCurrentIds.has(current.clientOrderId)) {
      actions.push({
        type: "cancel",
        clientOrderId: current.clientOrderId,
        exchangeOrderId: current.exchangeOrderId,
      });
    }
  }

  return actions;
}

/**
 * Plan execution actions from SET_ORDERS intent
 *
 * Requirements: 7.7, 7.8
 */
export function planExecution(
  intent: SetOrdersIntent,
  currentBid: TrackedOrder | undefined,
  currentAsk: TrackedOrder | undefined,
  lastQuoteMs: Ms | undefined,
  nowMs: Ms,
  params: StrategyParams,
  midPx: PriceStr,
): ExecutionAction[] {
  const currentOrders: TrackedOrder[] = [];
  if (currentBid) currentOrders.push(currentBid);
  if (currentAsk) currentOrders.push(currentAsk);

  return planSetOrdersExecution(intent.orders, currentOrders, lastQuoteMs, nowMs, params, midPx);
}
