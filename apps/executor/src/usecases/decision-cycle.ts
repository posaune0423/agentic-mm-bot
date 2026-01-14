/**
 * Decision Cycle - Main executor loop
 *
 * Requirements: 4.1-4.11
 * - Event-driven tick with throttling
 * - Read → Decide → Execute → Persist
 */

import type {
  DecideInput,
  DecideOutput,
  Features,
  Snapshot,
  StrategyParams,
  StrategyState,
} from "@agentic-mm-bot/core";
import { computeFeatures, decide } from "@agentic-mm-bot/core";
import type { ExecutionPort } from "@agentic-mm-bot/adapters";
import { logger } from "@agentic-mm-bot/utils";

import type { MarketDataCache } from "../services/market-data-cache";
import type { OrderTracker } from "../services/order-tracker";
import type { PositionTracker } from "../services/position-tracker";
import { generateClientOrderId, planExecution, type ExecutionAction } from "../services/execution-planner";

/**
 * cancel_all throttling
 *
 * In PAUSE mode, core `decide()` can emit CANCEL_ALL every tick. Without throttling,
 * this will hammer the exchange mass-cancel endpoint even when there are no orders.
 */
let lastCancelAllAttemptMs = 0;
let lastOpenOrdersSyncMs = 0;
const CANCEL_ALL_MIN_INTERVAL_WITH_ORDERS_MS = 1_000;
const CANCEL_ALL_MIN_INTERVAL_WITHOUT_ORDERS_MS = 30_000;
const OPEN_ORDERS_SYNC_INTERVAL_MS = 5_000;

/**
 * Decision cycle dependencies
 */
export interface DecisionCycleDeps {
  marketDataCache: MarketDataCache;
  orderTracker: OrderTracker;
  positionTracker: PositionTracker;
  executionPort: ExecutionPort;
  params: StrategyParams;
  /**
   * High-signal per-tick debug hook (for TTY dashboard / observability)
   */
  onTickDebug?: (args: {
    nowMs: number;
    snapshot: Snapshot;
    features: Features;
    stateBefore: StrategyState;
    stateAfter: StrategyState;
    output: DecideOutput;
    plannedActions: ExecutionAction[];
    targetQuote?: { bidPx: string; askPx: string; size: string };
  }) => void;
  /**
   * Action lifecycle hook (start/ok/err) for UI.
   */
  onAction?: (args: { phase: "start" | "ok" | "err"; action: ExecutionAction; error?: unknown }) => void;
  onStateChange?: (args: {
    nextState: StrategyState;
    reasonCodes: string[];
    intents: DecideOutput["intents"];
    debug: {
      dataAgeMs: number;
      lastUpdateMs: number;
      midPx: string;
      spreadBps: string;
      realizedVol10s: string;
      tradeImbalance1s: string;
      markIndexDivBps: string;
      liqCount10s: number;
      positionSize: string;
      activeOrders: number;
    };
  }) => void;
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
  const plannedActions: ExecutionAction[] = [];
  let targetQuote: { bidPx: string; askPx: string; size: string } | undefined;

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

    plannedActions.push(...actions);
    if (intent.type === "QUOTE") {
      targetQuote = { bidPx: intent.bidPx, askPx: intent.askPx, size: intent.size };
    }

    for (const action of actions) {
      await executeAction(action, executionPort, orderTracker, snapshot.symbol, deps.onAction);
    }
  }

  // For dashboards: emit a concise per-tick snapshot after executing.
  deps.onTickDebug?.({
    nowMs,
    snapshot,
    features,
    stateBefore: currentState,
    stateAfter: output.nextState,
    output,
    plannedActions,
    targetQuote,
  });

  // Step 7: Notify state change
  if (deps.onStateChange && output.nextState.mode !== currentState.mode) {
    deps.onStateChange({
      nextState: output.nextState,
      reasonCodes: output.reasonCodes,
      intents: output.intents,
      debug: {
        dataAgeMs: nowMs - snapshot.lastUpdateMs,
        lastUpdateMs: snapshot.lastUpdateMs,
        midPx: features.midPx,
        spreadBps: features.spreadBps,
        realizedVol10s: features.realizedVol10s,
        tradeImbalance1s: features.tradeImbalance1s,
        markIndexDivBps: features.markIndexDivBps,
        liqCount10s: features.liqCount10s,
        positionSize: position.size,
        activeOrders: orderTracker.getActiveOrders().length,
      },
    });
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
  action: ExecutionAction,
  executionPort: ExecutionPort,
  orderTracker: OrderTracker,
  symbol: string,
  onAction?: (args: { phase: "start" | "ok" | "err"; action: ExecutionAction; error?: unknown }) => void,
): Promise<void> {
  switch (action.type) {
    case "cancel_all": {
      onAction?.({ phase: "start", action });
      const nowMs = Date.now();
      let trackedCount = orderTracker.getActiveOrders().length;

      // If we believe there are no orders, periodically verify via REST to avoid tracker drift.
      // This is intentionally low-frequency to avoid hammering the exchange.
      if (trackedCount === 0 && nowMs - lastOpenOrdersSyncMs >= OPEN_ORDERS_SYNC_INTERVAL_MS) {
        lastOpenOrdersSyncMs = nowMs;
        const openOrdersResult = await executionPort.getOpenOrders(symbol);
        if (openOrdersResult.isOk()) {
          if (openOrdersResult.value.length > 0) {
            orderTracker.syncFromOpenOrders(openOrdersResult.value);
            trackedCount = openOrdersResult.value.length;
            logger.warn("Tracker drift detected: open orders exist while tracker empty", { openOrders: trackedCount });
          }
        } else {
          logger.debug("Failed to sync open orders during cancel_all", openOrdersResult.error);
        }
      }

      const minIntervalMs =
        trackedCount > 0 ? CANCEL_ALL_MIN_INTERVAL_WITH_ORDERS_MS : CANCEL_ALL_MIN_INTERVAL_WITHOUT_ORDERS_MS;

      if (nowMs - lastCancelAllAttemptMs < minIntervalMs) {
        // Skip repeated cancel_all when we're already clean (or recently attempted).
        break;
      }

      lastCancelAllAttemptMs = nowMs;

      const result = await executionPort.cancelAllOrders(symbol);
      if (result.isOk()) {
        onAction?.({ phase: "ok", action });
        orderTracker.clear();
        if (trackedCount > 0) {
          logger.info("Cancelled all orders", { trackedCount });
        } else {
          logger.debug("Issued cancel_all (no tracked orders)");
        }
      } else {
        onAction?.({ phase: "err", action, error: result.error });
        logger.error("Failed to cancel all orders", result.error);
      }
      break;
    }

    case "cancel": {
      onAction?.({ phase: "start", action });
      const result = await executionPort.cancelOrder({
        clientOrderId: action.clientOrderId,
        symbol,
      });
      if (result.isOk()) {
        onAction?.({ phase: "ok", action });
        logger.debug("Cancelled order", { clientOrderId: action.clientOrderId });
      } else {
        onAction?.({ phase: "err", action, error: result.error });
        logger.error("Failed to cancel order", result.error);
      }
      break;
    }

    case "place": {
      onAction?.({ phase: "start", action });
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
        onAction?.({ phase: "ok", action });
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
        onAction?.({ phase: "err", action, error: result.error });
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
