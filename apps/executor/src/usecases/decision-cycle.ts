/**
 * Decision Cycle - Main executor loop
 *
 * Requirements: 4.1-4.11
 * - Event-driven tick with throttling
 * - Read → Decide → Execute → Persist
 */

import type { DecideInput, DecideOutput, StrategyParams, StrategyState } from "@agentic-mm-bot/core";
import { computeFeatures, decide } from "@agentic-mm-bot/core";
import type { ExecutionPort } from "@agentic-mm-bot/adapters";
import { logger } from "@agentic-mm-bot/utils";

import type { MarketDataCache } from "../services/market-data-cache";
import type { OrderTracker } from "../services/order-tracker";
import type { PositionTracker } from "../services/position-tracker";
import { generateClientOrderId, planExecution } from "../services/execution-planner";

/**
 * Decision cycle dependencies
 */
export interface DecisionCycleDeps {
  marketDataCache: MarketDataCache;
  orderTracker: OrderTracker;
  positionTracker: PositionTracker;
  executionPort: ExecutionPort;
  params: StrategyParams;
  onStateChange?: (state: StrategyState) => void;
}

/**
 * Execute one decision cycle tick
 *
 * Requirements: 4.1-4.3
 * - Build snapshot from cache
 * - Compute features
 * - Run strategy decision
 * - Execute plan
 */
export async function executeTick(deps: DecisionCycleDeps, currentState: StrategyState): Promise<DecideOutput> {
  const nowMs = Date.now();
  const { marketDataCache, orderTracker, positionTracker, executionPort, params } = deps;

  // Step 1: Build snapshot
  const snapshot = marketDataCache.getSnapshot(nowMs);

  // Step 2: Get trades for feature calculation
  const trades1s = marketDataCache.getTradesInWindow(nowMs, 1000);
  const trades10s = marketDataCache.getTradesInWindow(nowMs, 10_000);
  const midSnapshots10s = marketDataCache.getMidSnapshotsInWindow(nowMs, 10_000);

  // Step 3: Compute features
  const features = computeFeatures(snapshot, trades1s, trades10s, midSnapshots10s, params);

  // Step 4: Get position
  const position = positionTracker.getPosition();

  // Step 5: Run strategy decision
  const input: DecideInput = {
    nowMs,
    state: currentState,
    features,
    params,
    position,
  };

  const output = decide(input);

  // Step 6: Plan and execute
  for (const intent of output.intents) {
    const currentBid = orderTracker.getBidOrder();
    const currentAsk = orderTracker.getAskOrder();

    const actions = planExecution(
      intent,
      currentBid,
      currentAsk,
      currentState.lastQuoteMs,
      nowMs,
      params,
      features.midPx,
    );

    for (const action of actions) {
      await executeAction(action, executionPort, orderTracker, snapshot.symbol);
    }
  }

  // Step 7: Notify state change
  if (deps.onStateChange && output.nextState.mode !== currentState.mode) {
    deps.onStateChange(output.nextState);
  }

  // Log decision
  logger.debug("Tick completed", {
    mode: output.nextState.mode,
    reasonCodes: output.reasonCodes,
    intents: output.intents.length,
  });

  return output;
}

/**
 * Execute a single action
 */
async function executeAction(
  action:
    | { type: "cancel_all" }
    | { type: "cancel"; clientOrderId: string }
    | { type: "place"; side: "buy" | "sell"; price: string; size: string },
  executionPort: ExecutionPort,
  orderTracker: OrderTracker,
  symbol: string,
): Promise<void> {
  switch (action.type) {
    case "cancel_all": {
      const result = await executionPort.cancelAllOrders(symbol);
      if (result.isOk()) {
        orderTracker.clear();
        logger.info("Cancelled all orders");
      } else {
        logger.error("Failed to cancel all orders", result.error);
      }
      break;
    }

    case "cancel": {
      const result = await executionPort.cancelOrder({
        clientOrderId: action.clientOrderId,
        symbol,
      });
      if (result.isOk()) {
        logger.debug("Cancelled order", { clientOrderId: action.clientOrderId });
      } else {
        logger.error("Failed to cancel order", result.error);
      }
      break;
    }

    case "place": {
      const clientOrderId = generateClientOrderId();
      const result = await executionPort.placeOrder({
        clientOrderId,
        symbol,
        side: action.side,
        price: action.price,
        size: action.size,
        postOnly: true,
      });

      if (result.isOk()) {
        orderTracker.addOrder({
          clientOrderId,
          exchangeOrderId: result.value.exchangeOrderId,
          side: action.side,
          price: action.price,
          size: action.size,
          createdAtMs: Date.now(),
        });
        logger.debug("Placed order", { clientOrderId, side: action.side, price: action.price });
      } else {
        // Check for post-only rejection
        if (result.error.type === "post_only_rejected") {
          logger.warn("Post-only rejected, will retry next tick");
        } else {
          logger.error("Failed to place order", result.error);
        }
      }
      break;
    }
  }
}
