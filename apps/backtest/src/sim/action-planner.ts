/**
 * Action Planner - Convert intents to simulated actions
 *
 * Requirements: 7.7, 7.8
 * - Minimal order updates (diff-based)
 * - refresh_interval_ms and stale_cancel_ms enforcement
 *
 * Simplified version of executor's execution-planner for backtest use.
 */

import type { Ms, PriceStr, SetOrdersIntent, StrategyParams } from "@agentic-mm-bot/core";
import { priceExceedsThreshold } from "@agentic-mm-bot/core";
import type { SimExecution, SimOrder } from "./sim-execution";

/**
 * Simulated action types
 */
export type SimAction =
  | { type: "cancel_all" }
  | { type: "cancel_bid" }
  | { type: "cancel_ask" }
  | { type: "place_bid"; price: PriceStr; size: string }
  | { type: "place_ask"; price: PriceStr; size: string };

/**
 * Minimum requote threshold in bps
 */
const MIN_REQUOTE_BPS = 1;

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
  intent: SetOrdersIntent,
  simExec: SimExecution,
  lastQuoteMs: Ms | undefined,
  nowMs: Ms,
  params: StrategyParams,
  midPx: PriceStr,
): SimAction[] {
  const actions: SimAction[] = [];

  const desiredQuotes = intent.orders.filter(o => o.kind === "quote");
  const desiredBid = desiredQuotes.find(o => o.side === "buy");
  const desiredAsk = desiredQuotes.find(o => o.side === "sell");

  const currentBid = simExec.getBidOrder();
  const currentAsk = simExec.getAskOrder();

  // Empty desired → cancel all if we currently have any orders
  if (!desiredBid && !desiredAsk) {
    if (currentBid || currentAsk) return [{ type: "cancel_all" }];
    return [];
  }

  // Check refresh interval
  const canRefresh = lastQuoteMs === undefined || nowMs - lastQuoteMs >= params.refreshIntervalMs;

  // Process bid side
  if (desiredBid) {
    if (currentBid) {
      const stale = isOrderStale(currentBid, nowMs, params.staleCancelMs);
      const needsUpdate =
        priceExceedsThreshold(currentBid.price, desiredBid.price, midPx, MIN_REQUOTE_BPS) && canRefresh;

      if (stale || needsUpdate) {
        // Cancels existing and places new (SimExecution overwrites)
        actions.push({ type: "place_bid", price: desiredBid.price, size: desiredBid.size });
      }
    } else if (canRefresh) {
      actions.push({ type: "place_bid", price: desiredBid.price, size: desiredBid.size });
    }
  } else if (currentBid) {
    // No desired bid → cancel only bid side
    actions.push({ type: "cancel_bid" });
  }

  // Process ask side
  if (desiredAsk) {
    if (currentAsk) {
      const stale = isOrderStale(currentAsk, nowMs, params.staleCancelMs);
      const needsUpdate =
        priceExceedsThreshold(currentAsk.price, desiredAsk.price, midPx, MIN_REQUOTE_BPS) && canRefresh;

      if (stale || needsUpdate) {
        actions.push({ type: "place_ask", price: desiredAsk.price, size: desiredAsk.size });
      }
    } else if (canRefresh) {
      actions.push({ type: "place_ask", price: desiredAsk.price, size: desiredAsk.size });
    }
  } else if (currentAsk) {
    // No desired ask → cancel only ask side
    actions.push({ type: "cancel_ask" });
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
      case "cancel_bid":
        simExec.cancelBid();
        break;
      case "cancel_ask":
        simExec.cancelAsk();
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
