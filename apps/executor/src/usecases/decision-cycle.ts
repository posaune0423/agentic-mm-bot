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
import { clampPriceToBbo } from "../services/bbo-clamp";
import { generateClientOrderId, planExecution } from "../services/execution-planner";
import type { ExecutionAction } from "../services/execution-planner";

type DecisionCycleMarketDataCache = Pick<
  MarketDataCache,
  "getSnapshot" | "getTradesInWindow" | "getMidSnapshotsInWindow"
> & {
  /**
   * Optional for backward-compatibility: some tests/mocks may not implement this method.
   */
  getOpenInterestShockBps?: MarketDataCache["getOpenInterestShockBps"];
};

/**
 * cancel_all throttling
 *
 * In PAUSE mode, core `decide()` emits SET_ORDERS with empty `orders`. Without throttling,
 * this can hammer the exchange mass-cancel endpoint when there are open orders.
 */
const CANCEL_ALL_MIN_INTERVAL_WITH_ORDERS_MS = 1_000;
const CANCEL_ALL_MIN_INTERVAL_WITHOUT_ORDERS_MS = 30_000;
const OPEN_ORDERS_SYNC_INTERVAL_MS = 5_000;
/**
 * Periodic reconciliation interval (ms)
 * Runs in every tick if enough time has passed, to detect tracker drift.
 * Set to 30s to balance accuracy vs rate limit risk.
 */
const PERIODIC_RECONCILE_INTERVAL_MS = 30_000;

// Post-only rejection backoff (per side) to avoid reject spam.
// When the exchange rejects post-only, retrying immediately at 200ms tick just spams the venue and logs.
// We back off for a short (exponential-ish) window and let the next refresh / market move settle.
const POST_ONLY_REJECT_BACKOFF_MIN_MS = 1_000;
const POST_ONLY_REJECT_BACKOFF_MAX_MS = 10_000;

/**
 * Mutable runtime state for throttling/backoff.
 *
 * Kept module-local (single process) and intentionally not persisted.
 */
const runtimeState = {
  lastCancelAllAttemptMs: 0,
  lastOpenOrdersSyncMs: 0,
  lastPeriodicReconcileMs: 0,
  rateLimitUntilMs: 0,
  postOnlyRejectUntilBySide: { buy: 0, sell: 0 } satisfies Record<"buy" | "sell", number>,
  postOnlyRejectStreakBySide: { buy: 0, sell: 0 } satisfies Record<"buy" | "sell", number>,
};

/**
 * Decision cycle dependencies
 */
type ExecutorPhase = "IDLE" | "READ" | "DECIDE" | "PLAN" | "EXECUTE" | "PERSIST";

export interface DecisionCycleDeps {
  marketDataCache: DecisionCycleMarketDataCache;
  orderTracker: OrderTracker;
  positionTracker: PositionTracker;
  executionPort: ExecutionPort;
  params: StrategyParams;
  /**
   * Optional phase hook for CLI dashboard / observability.
   *
   * This is best-effort and should never throw or block the hot path.
   */
  onPhase?: (phase: ExecutorPhase) => void;
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
      dataAgeMs: number | null;
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

async function periodicReconcileIfDue(args: {
  nowMs: number;
  symbol: string;
  orderTracker: OrderTracker;
  executionPort: ExecutionPort;
}): Promise<void> {
  const { nowMs, symbol, orderTracker, executionPort } = args;

  // Periodic reconciliation: sync tracker with exchange to detect drift.
  // This runs every PERIODIC_RECONCILE_INTERVAL_MS regardless of tracker state.
  if (
    nowMs - runtimeState.lastPeriodicReconcileMs < PERIODIC_RECONCILE_INTERVAL_MS ||
    nowMs < runtimeState.rateLimitUntilMs
  ) {
    return;
  }

  runtimeState.lastPeriodicReconcileMs = nowMs;
  const reconcileResult = await executionPort.getOpenOrders(symbol);
  if (reconcileResult.isOk()) {
    const exchangeOrders = reconcileResult.value;
    const trackedOrders = orderTracker.getActiveOrders();

    // Build sets for comparison
    const exchangeIds = new Set(exchangeOrders.map(o => o.exchangeOrderId));
    const trackedExchangeIds = new Set(
      trackedOrders.map(o => o.exchangeOrderId).filter((id): id is string => id !== undefined),
    );

    // Detect drift: orders on exchange not in tracker, or orders in tracker not on exchange
    const missingInTracker = exchangeOrders.filter(o => !trackedExchangeIds.has(o.exchangeOrderId));
    const staleInTracker = trackedOrders.filter(
      o => o.exchangeOrderId !== undefined && !exchangeIds.has(o.exchangeOrderId),
    );

    if (missingInTracker.length > 0 || staleInTracker.length > 0) {
      logger.warn("Periodic reconciliation detected drift; syncing from exchange", {
        missingInTracker: missingInTracker.length,
        staleInTracker: staleInTracker.length,
        exchangeOrderCount: exchangeOrders.length,
        trackedOrderCount: trackedOrders.length,
      });

      // Sync from exchange to fix drift
      orderTracker.syncFromOpenOrders(exchangeOrders);
    } else {
      logger.debug("Periodic reconciliation: no drift detected", {
        exchangeOrderCount: exchangeOrders.length,
        trackedOrderCount: trackedOrders.length,
      });
    }
    return;
  }

  logger.debug("Periodic reconciliation failed", reconcileResult.error);
  if (reconcileResult.error.type === "rate_limit") {
    runtimeState.rateLimitUntilMs = nowMs + (reconcileResult.error.retryAfterMs ?? 1000);
  }
}

function shouldGuardrailCancelAll(orderTracker: OrderTracker): boolean {
  // Guardrail: we expect at most 1 bid + 1 ask live. If there's more, clean slate first.
  const orders = orderTracker.getActiveOrders();
  const buyCount = orders.filter(o => o.side === "buy").length;
  const sellCount = orders.length - buyCount;
  return orders.length > 2 || buyCount > 1 || sellCount > 1;
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
  deps.onPhase?.("READ");
  const snapshot = marketDataCache.getSnapshot(nowMs);

  // Step 2: Get trades for feature calculation
  const trades1s = marketDataCache.getTradesInWindow(nowMs, 1000);
  const trades10s = marketDataCache.getTradesInWindow(nowMs, 10_000);
  const midSnapshots10s = marketDataCache.getMidSnapshotsInWindow(nowMs, 10_000);

  // Step 3: Compute features
  const baseFeatures = computeFeatures(snapshot, trades1s, trades10s, midSnapshots10s, params);
  const oiShockBps = marketDataCache.getOpenInterestShockBps?.(nowMs, 5 * 60 * 1000);
  const features = oiShockBps ? { ...baseFeatures, openInterestShockBps: oiShockBps } : baseFeatures;

  // Step 4: Get position
  const position = positionTracker.getPosition();

  // Step 5: Run strategy decision
  deps.onPhase?.("DECIDE");
  const input: DecideInput = {
    nowMs,
    state: currentState,
    features,
    params,
    position,
  };

  const output = decide(input);

  // Step 6: Plan and execute
  deps.onPhase?.("PLAN");
  const plannedActions: ExecutionAction[] = [];
  let targetQuote: { bidPx: string; askPx: string; size: string } | undefined;

  deps.onPhase?.("EXECUTE");

  await periodicReconcileIfDue({ nowMs, symbol: snapshot.symbol, orderTracker, executionPort });

  if (shouldGuardrailCancelAll(orderTracker)) {
    const guardrailAction: ExecutionAction = { type: "cancel_all" };
    await executeAction(guardrailAction, executionPort, orderTracker, snapshot, deps.onAction);

    // Emit the same state/debug notifications as the normal path so dashboards stay in sync.
    // No quote orders are placed in guardrail path, so nextState is simply output.nextState.
    const nextState = output.nextState;

    deps.onTickDebug?.({
      nowMs,
      snapshot,
      features,
      stateBefore: currentState,
      stateAfter: nextState,
      output,
      plannedActions: [guardrailAction],
      targetQuote: undefined,
    });

    if (deps.onStateChange && nextState.mode !== currentState.mode) {
      deps.onStateChange({
        nextState,
        reasonCodes: output.reasonCodes,
        intents: output.intents,
        debug: {
          dataAgeMs: snapshot.lastUpdateMs > 0 ? nowMs - snapshot.lastUpdateMs : null,
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

    logger.debug("Tick completed (guardrail cancel_all)", {
      mode: nextState.mode,
      reasonCodes: output.reasonCodes,
      intents: output.intents.length,
    });

    deps.onPhase?.("IDLE");
    return output;
  }

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
    const bid = intent.orders.find(o => o.kind === "quote" && o.side === "buy");
    const ask = intent.orders.find(o => o.kind === "quote" && o.side === "sell");
    if (bid && ask) {
      targetQuote = {
        bidPx: bid.price,
        askPx: ask.price,
        size: bid.size,
      };
    }

    for (const action of actions) {
      await executeAction(action, executionPort, orderTracker, snapshot, deps.onAction);
    }
  }

  // Update lastQuoteMs only when we actually attempted to place quote orders.
  // Core decide() is pure and cannot know whether orders were placed; executor is the source of truth.
  const didAttemptQuotePlace = plannedActions.some(
    a => a.type === "place" && a.postOnly && !a.reduceOnly && a.timeInForce === "GTC",
  );
  const nextState = didAttemptQuotePlace ? { ...output.nextState, lastQuoteMs: nowMs } : output.nextState;

  // For dashboards: emit a concise per-tick snapshot after executing.
  deps.onTickDebug?.({
    nowMs,
    snapshot,
    features,
    stateBefore: currentState,
    stateAfter: nextState,
    output,
    plannedActions,
    targetQuote,
  });

  // Step 7: Notify state change
  if (deps.onStateChange && nextState.mode !== currentState.mode) {
    deps.onStateChange({
      nextState,
      reasonCodes: output.reasonCodes,
      intents: output.intents,
      debug: {
        dataAgeMs: snapshot.lastUpdateMs > 0 ? nowMs - snapshot.lastUpdateMs : null,
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

  deps.onPhase?.("IDLE");
  return { ...output, nextState };
}

/**
 * Execute a single action
 */
async function executeAction(
  action: ExecutionAction,
  executionPort: ExecutionPort,
  orderTracker: OrderTracker,
  snapshot: Snapshot,
  onAction?: (args: { phase: "start" | "ok" | "err"; action: ExecutionAction; error?: unknown }) => void,
): Promise<void> {
  const symbol = snapshot.symbol;
  const nowMs = Date.now();
  if (nowMs < runtimeState.rateLimitUntilMs) {
    // Skip API calls during backoff window.
    return;
  }
  switch (action.type) {
    case "cancel_all": {
      onAction?.({ phase: "start", action });
      const nowMs = Date.now();
      let trackedCount = orderTracker.getActiveOrders().length;

      // If we believe there are no orders, periodically verify via REST to avoid tracker drift.
      // This is intentionally low-frequency to avoid hammering the exchange.
      if (trackedCount === 0 && nowMs - runtimeState.lastOpenOrdersSyncMs >= OPEN_ORDERS_SYNC_INTERVAL_MS) {
        runtimeState.lastOpenOrdersSyncMs = nowMs;
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

      if (nowMs - runtimeState.lastCancelAllAttemptMs < minIntervalMs) {
        // Skip repeated cancel_all when we're already clean (or recently attempted).
        break;
      }

      runtimeState.lastCancelAllAttemptMs = nowMs;

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
        if (result.error.type === "rate_limit") {
          runtimeState.rateLimitUntilMs = Date.now() + (result.error.retryAfterMs ?? 1000);
        }
        onAction?.({ phase: "err", action, error: result.error });
        logger.error("Failed to cancel all orders", result.error);
      }
      break;
    }

    case "cancel": {
      onAction?.({ phase: "start", action });
      const tracked = orderTracker.getOrder(action.clientOrderId);

      // If clientOrderId is a fallback key (generated from exchangeOrderId),
      // use exchangeOrderId for cancellation since the exchange doesn't know about our fallback key
      const isFallbackKey = action.clientOrderId.startsWith("__ext_");
      logger.debug("Cancelling order", {
        clientOrderId: action.clientOrderId,
        isFallbackKey,
        tracked: Boolean(tracked),
      });
      const result = await executionPort.cancelOrder({
        clientOrderId: isFallbackKey ? undefined : action.clientOrderId,
        exchangeOrderId: isFallbackKey ? action.exchangeOrderId : undefined,
        symbol,
      });
      if (result.isOk()) {
        const removed = orderTracker.removeOrder(action.clientOrderId);
        onAction?.({ phase: "ok", action });
        logger.debug("Cancelled order", {
          clientOrderId: action.clientOrderId,
          removedFromTracker: removed,
        });
      } else {
        if (result.error.type === "rate_limit") {
          runtimeState.rateLimitUntilMs = Date.now() + (result.error.retryAfterMs ?? 1000);
        }
        onAction?.({ phase: "err", action, error: result.error });
        // Best-effort cleanup: if the exchange says the order doesn't exist, drop it from the tracker.
        if (
          result.error.type === "exchange_error" &&
          /not\s*found|does\s*not\s*exist|unknown\s*order|order\s*.*not\s*found/i.test(result.error.message)
        ) {
          const removed = orderTracker.removeOrder(action.clientOrderId);
          logger.warn("Cancel failed (order missing); removed from tracker", {
            clientOrderId: action.clientOrderId,
            removedFromTracker: removed,
            message: result.error.message,
          });
        } else {
          logger.error("Failed to cancel order", result.error);
        }
      }
      break;
    }

    case "place": {
      // Skip aggressive retry loops on post-only rejection.
      if (action.postOnly) {
        const until = runtimeState.postOnlyRejectUntilBySide[action.side];
        if (nowMs < until) {
          return;
        }
      }

      onAction?.({ phase: "start", action });
      const clientOrderId = generateClientOrderId();

      const { postOnly, reduceOnly, timeInForce } = action;

      let finalPrice = action.price;
      let clamped = false;

      // Only clamp price for post-only orders
      if (postOnly) {
        const clampResult = clampPriceToBbo(action.side, action.price, snapshot.bestBidPx, snapshot.bestAskPx);
        finalPrice = clampResult.adjustedPrice;
        clamped = clampResult.clamped;

        if (clamped) {
          logger.warn("Price clamped to avoid BBO crossing", {
            side: action.side,
            originalPrice: action.price,
            adjustedPrice: finalPrice,
            bestBidPx: snapshot.bestBidPx,
            bestAskPx: snapshot.bestAskPx,
          });
        }
      }

      const result = await executionPort.placeOrder({
        clientOrderId,
        symbol,
        side: action.side,
        price: finalPrice,
        size: action.size,
        postOnly,
        reduceOnly,
        timeInForce,
      });

      if (result.isOk()) {
        onAction?.({ phase: "ok", action });
        if (result.value.status === "rejected") {
          // Some venues can return an immediate reject while the request itself succeeded.
          logger.warn("Order placement returned rejected; will not track", {
            clientOrderId,
            side: action.side,
            price: finalPrice,
            postOnly,
            reduceOnly,
            timeInForce,
            reason: result.value.reason,
          });

          if (postOnly && result.value.reason?.includes("POST_ONLY")) {
            // Treat immediate post-only rejection the same as an error path for backoff.
            const streak = runtimeState.postOnlyRejectStreakBySide[action.side] + 1;
            runtimeState.postOnlyRejectStreakBySide[action.side] = streak;
            const delay = Math.min(
              POST_ONLY_REJECT_BACKOFF_MAX_MS,
              POST_ONLY_REJECT_BACKOFF_MIN_MS * Math.pow(2, Math.min(4, streak - 1)),
            );
            runtimeState.postOnlyRejectUntilBySide[action.side] = Date.now() + delay;
          }
          break;
        }

        // Reset reject streak on success (per side).
        runtimeState.postOnlyRejectStreakBySide[action.side] = 0;

        // Only track GTC orders (IOC orders fill immediately or cancel)
        if (timeInForce === "GTC") {
          orderTracker.addOrder({
            clientOrderId,
            exchangeOrderId: result.value.exchangeOrderId,
            side: action.side,
            price: finalPrice,
            size: action.size,
            createdAtMs: Date.now(),
          });
        }
        logger.debug("Placed order", {
          clientOrderId,
          side: action.side,
          price: finalPrice,
          postOnly,
          reduceOnly,
          timeInForce,
          clamped,
        });
      } else {
        if (result.error.type === "rate_limit") {
          runtimeState.rateLimitUntilMs = Date.now() + (result.error.retryAfterMs ?? 1000);
        }
        onAction?.({ phase: "err", action, error: result.error });
        // Check for post-only rejection
        if (result.error.type === "post_only_rejected") {
          const streak = runtimeState.postOnlyRejectStreakBySide[action.side] + 1;
          runtimeState.postOnlyRejectStreakBySide[action.side] = streak;
          const delay = Math.min(
            POST_ONLY_REJECT_BACKOFF_MAX_MS,
            POST_ONLY_REJECT_BACKOFF_MIN_MS * Math.pow(2, Math.min(4, streak - 1)),
          );
          runtimeState.postOnlyRejectUntilBySide[action.side] = Date.now() + delay;
          logger.warn("Post-only rejected; backing off", { side: action.side, streak, delayMs: delay });
        } else {
          logger.error("Failed to place order", result.error);
        }
      }
      break;
    }
  }
}
