/**
 * Executor Main Entry Point
 *
 * Requirements: 4.1-4.11
 * - Composition root for executor
 * - Event-driven tick loop
 * - State persistence (4.11)
 * - Non-blocking event logging (4.10)
 */

import { createInitialState, ALLOWED_PARAM_KEYS } from "@agentic-mm-bot/core";
import type { StrategyParams, StrategyState } from "@agentic-mm-bot/core";
import { ExtendedExecutionAdapter, ExtendedMarketDataAdapter, initWasm } from "@agentic-mm-bot/adapters";
import type { StrategyParams as DbStrategyParams } from "@agentic-mm-bot/db";
import { getDb } from "@agentic-mm-bot/db";
import { LogLevel, logger } from "@agentic-mm-bot/utils";

import { env } from "./env";
import { MarketDataCache } from "./services/market-data-cache";
import { OrderTracker } from "./services/order-tracker";
import { PositionTracker } from "./services/position-tracker";
import { ExecutorCliDashboard } from "./services/cli-dashboard";
import { buildLatestPositionState } from "./services/latest-position-publisher";
import { executeTick } from "./usecases/decision-cycle";
import { ParamsOverlayManager, computeParamsSignature } from "./services/params-overlay";
import {
  createPostgresEventRepository,
  createPostgresMetricsRepository,
  createPostgresPositionRepository,
  createPostgresProposalRepository,
  createPostgresStrategyStateRepository,
} from "@agentic-mm-bot/repositories";
import { isAtTimeBoundary, processPendingProposals } from "./services/proposal-applier";

/**
 * Main executor function
 */
async function main(): Promise<void> {
  // CLI dashboard (TTY UI)
  const dashboard = new ExecutorCliDashboard({
    enabled: env.EXECUTOR_DASHBOARD,
    exchange: env.EXCHANGE,
    symbol: env.SYMBOL,
    refreshMs: env.EXECUTOR_DASHBOARD_REFRESH_MS,
  });
  dashboard.start();
  dashboard.pushEvent(LogLevel.INFO, "executor started", {
    exchange: env.EXCHANGE,
    symbol: env.SYMBOL,
  });

  // Initialize WASM first
  try {
    await initWasm();
    logger.info("WASM initialized successfully (signer)");
  } catch (error) {
    logger.error("Failed to initialize WASM", error);
    throw new Error("WASM initialization failed");
  }

  logger.info("Starting executor", {
    exchange: env.EXCHANGE,
    symbol: env.SYMBOL,
  });

  // Initialize database connection
  const db = getDb(env.DATABASE_URL);

  // Initialize repositories
  const strategyStateRepo = createPostgresStrategyStateRepository(db);
  const eventRepo = createPostgresEventRepository(db);
  const proposalRepo = createPostgresProposalRepository(db);
  const metricsRepo = createPostgresMetricsRepository(db);
  const positionRepo = createPostgresPositionRepository(db);

  // Start periodic event flush (non-blocking - Requirement 4.10)
  eventRepo.startPeriodicFlush(env.EVENT_FLUSH_INTERVAL_MS);

  // Initialize adapters
  const marketDataAdapter = new ExtendedMarketDataAdapter({
    network: env.EXTENDED_NETWORK,
    apiKey: env.EXTENDED_API_KEY,
    starkPrivateKey: env.EXTENDED_STARK_PRIVATE_KEY,
    starkPublicKey: env.EXTENDED_STARK_PUBLIC_KEY,
    vaultId: env.EXTENDED_VAULT_ID,
  });

  const executionAdapter = new ExtendedExecutionAdapter({
    network: env.EXTENDED_NETWORK,
    apiKey: env.EXTENDED_API_KEY,
    starkPrivateKey: env.EXTENDED_STARK_PRIVATE_KEY,
    starkPublicKey: env.EXTENDED_STARK_PUBLIC_KEY,
    vaultId: env.EXTENDED_VAULT_ID,
  });

  // Initialize services
  const marketDataCache = new MarketDataCache(env.EXCHANGE, env.SYMBOL);
  const orderTracker = new OrderTracker();
  const positionTracker = new PositionTracker();

  // Helper function to sync open orders (reusable for startup and re-sync)
  const syncOpenOrders = async (context: string): Promise<boolean> => {
    logger.info(`[${context}] Syncing open orders...`);
    const result = await executionAdapter.getOpenOrders(env.SYMBOL);
    if (result.isOk()) {
      const orders = result.value;
      orderTracker.syncFromOpenOrders(orders);

      // Log detailed info about synced orders
      const buyOrders = orders.filter(o => o.side === "buy");
      const sellOrders = orders.filter(o => o.side === "sell");
      const details = orders.map(o => ({
        clientOrderId: o.clientOrderId.slice(0, 16),
        exchangeOrderId: o.exchangeOrderId,
        side: o.side,
        price: o.price,
        size: o.size,
        isFallbackKey: o.clientOrderId.startsWith("__ext_"),
      }));

      dashboard.pushEvent(
        LogLevel.INFO,
        `[${context}] synced open orders: ${String(orders.length)} (buy: ${String(buyOrders.length)}, sell: ${String(sellOrders.length)})`,
      );
      logger.info(`[${context}] Synced open orders`, {
        count: orders.length,
        buyCount: buyOrders.length,
        sellCount: sellOrders.length,
        fallbackKeyCount: orders.filter(o => o.clientOrderId.startsWith("__ext_")).length,
        orders: details,
      });
      return true;
    } else {
      dashboard.pushEvent(
        LogLevel.WARN,
        `[${context}] failed to sync open orders; proceeding with current tracker state`,
        result.error,
      );
      logger.warn(`[${context}] Failed to sync open orders`, result.error);
      return false;
    }
  };

  // Initial sync of open orders on startup
  await syncOpenOrders("startup");

  // Sync current position on startup
  logger.info("Syncing current position...");
  const positionResult = await executionAdapter.getPosition(env.SYMBOL);
  if (positionResult.isOk()) {
    positionTracker.syncFromPosition(positionResult.value);
    const pos = positionResult.value;
    if (pos) {
      dashboard.pushEvent(
        LogLevel.INFO,
        `position synced: size=${pos.size} entry=${pos.entryPrice ?? "-"} uPnL=${pos.unrealizedPnl ?? "-"}`,
      );
      logger.info("Synced position", {
        size: pos.size,
        entryPrice: pos.entryPrice,
        unrealizedPnl: pos.unrealizedPnl,
      });
    } else {
      dashboard.pushEvent(LogLevel.INFO, "position synced: no open position");
      logger.info("Synced position: no open position");
    }
  } else {
    dashboard.pushEvent(LogLevel.WARN, "failed to sync position; proceeding with zero position", positionResult.error);
    logger.warn("Failed to sync position, proceeding with zero position", positionResult.error);
  }

  const toCoreParams = (p: DbStrategyParams): StrategyParams => ({
    baseHalfSpreadBps: p.baseHalfSpreadBps,
    volSpreadGain: p.volSpreadGain,
    toxSpreadGain: p.toxSpreadGain,
    quoteSizeUsd: p.quoteSizeUsd,
    refreshIntervalMs: p.refreshIntervalMs,
    staleCancelMs: p.staleCancelMs,
    maxInventory: p.maxInventory,
    inventorySkewGain: p.inventorySkewGain,
    pauseMarkIndexBps: p.pauseMarkIndexBps,
    pauseLiqCount10s: p.pauseLiqCount10s,
  });

  // Strategy params (live, refreshable)
  // Must always be a string because FillRecord.paramsSetId is required.
  // Use the same safe default ID as repositories fallback when DB has no current params.
  const DEFAULT_PARAMS_SET_ID = "00000000-0000-0000-0000-000000000000";
  let params: StrategyParams = {
    baseHalfSpreadBps: "10",
    volSpreadGain: "1",
    toxSpreadGain: "1",
    quoteSizeUsd: "50", // $50 per order (fallback)
    refreshIntervalMs: 1000,
    staleCancelMs: 5000,
    maxInventory: "1",
    inventorySkewGain: "5",
    pauseMarkIndexBps: "50",
    pauseLiqCount10s: 3,
  };
  let currentParamsSetId: string = DEFAULT_PARAMS_SET_ID;

  // Load current params from DB (keeps executor aligned with reflector/proposals).
  {
    const dbParamsResult = await proposalRepo.getCurrentParams(env.EXCHANGE, env.SYMBOL);
    if (dbParamsResult.isOk()) {
      params = toCoreParams(dbParamsResult.value);
      currentParamsSetId = dbParamsResult.value.id;
      dashboard.pushEvent(LogLevel.INFO, `loaded current params from DB: id=${currentParamsSetId}`);
      logger.info("Loaded current params from DB", {
        paramsSetId: currentParamsSetId,
      });
    } else {
      dashboard.pushEvent(LogLevel.WARN, "failed to load params from DB; using defaults", dbParamsResult.error);
      logger.warn("Failed to load params from DB; using defaults", dbParamsResult.error);
    }
  }

  // Params overlay manager: adjusts baseHalfSpreadBps when fills are sparse (memory-only)
  const paramsOverlay = new ParamsOverlayManager({
    noFillWindowMs: 120_000, // 2 min without fills
    tightenStepBps: 0.5, // tighten by 0.5 bps per step
    minBaseHalfSpreadBps: 5, // floor
    tightenIntervalMs: 60_000, // max 1 step per minute
  });

  // Load last state from DB or initialize (Requirement 4.11)
  let state: StrategyState;
  const savedState = await strategyStateRepo.getLatest(env.EXCHANGE, env.SYMBOL);

  if (savedState.isOk() && savedState.value) {
    logger.info("Restored state from DB", {
      mode: savedState.value.mode,
      modeSince: savedState.value.modeSince,
    });
    state = {
      mode: savedState.value.mode,
      modeSinceMs: savedState.value.modeSince?.getTime() ?? Date.now(),
      pauseUntilMs: savedState.value.pauseUntil?.getTime() ?? undefined,
      lastQuoteMs: 0,
    };
  } else {
    logger.info("No saved state found, starting in PAUSE mode");
    state = createInitialState(Date.now());
  }

  // Set up market data event handlers
  marketDataAdapter.onEvent(event => {
    switch (event.type) {
      case "bbo":
        marketDataCache.updateBbo(event);
        break;
      case "trade":
        marketDataCache.addTrade(event);
        break;
      case "price":
        marketDataCache.updatePrice(event);
        break;
      case "funding":
        marketDataCache.updateFunding(event);
        break;
      case "connected":
        dashboard.setConnectionStatus("connected");
        logger.info("Market data connected");
        break;
      case "disconnected":
        dashboard.setConnectionStatus("disconnected");
        logger.warn("Market data disconnected");
        break;
      case "reconnecting":
        dashboard.setConnectionStatus("reconnecting", event.reason);
        logger.info("Market data reconnecting", { reason: event.reason });
        break;
    }
  });

  // Set up execution event handlers
  executionAdapter.onEvent(event => {
    switch (event.type) {
      case "fill":
        orderTracker.updateFromFill(event);
        positionTracker.updateFromFill(event);
        dashboard.onExecutionEvent(event);

        // Update dashboard position immediately for realtime display
        dashboard.setPosition({
          size: positionTracker.getPosition().size,
          entryPrice: positionTracker.getEntryPrice(),
          unrealizedPnl: positionTracker.getUnrealizedPnl(),
          lastUpdateMs: positionTracker.getLastUpdateMs(),
        });

        // Notify overlay manager (resets spread tightening on fill)
        paramsOverlay.onFill(event.ts.getTime());

        // Queue fill for async persistence (Requirement 4.10)
        eventRepo.queueFill({
          ts: event.ts,
          exchange: env.EXCHANGE,
          symbol: event.symbol,
          clientOrderId: event.clientOrderId,
          exchangeOrderId: event.exchangeOrderId ?? null,
          side: event.side as "buy" | "sell",
          fillPx: event.price,
          fillSz: event.size,
          fee: event.fee ?? null,
          liquidity: event.liquidity as "maker" | "taker" | null,
          state: state.mode,
          paramsSetId: currentParamsSetId,
          rawJson: null,
        });

        logger.info("Fill received", {
          side: event.side,
          price: event.price,
          size: event.size,
        });
        break;

      case "order_update":
        orderTracker.updateFromOrderEvent(event);
        dashboard.onExecutionEvent(event);

        // Queue order event for async persistence
        eventRepo.queueOrderEvent({
          ts: event.ts,
          exchange: env.EXCHANGE,
          symbol: env.SYMBOL,
          clientOrderId: event.clientOrderId,
          exchangeOrderId: event.exchangeOrderId ?? null,
          eventType: event.status === "rejected" ? "reject" : "ack",
          side: null,
          px: null,
          sz: null,
          postOnly: true,
          reason: event.reason ?? null,
          state: state.mode,
          paramsSetId: null,
          rawJson: null,
        });
        break;
    }
  });

  // Connect to market data
  logger.info("Connecting to market data...");
  const connectResult = await marketDataAdapter.connect();
  if (connectResult.isErr()) {
    logger.error("Failed to connect to market data", connectResult.error);
    throw new Error("Market data connection failed");
  }
  dashboard.pushEvent(LogLevel.INFO, "market data connected");

  // Subscribe to market data
  marketDataAdapter.subscribe({
    exchange: env.EXCHANGE,
    symbol: env.SYMBOL,
    channels: ["bbo", "trades", "prices", "funding"],
  });

  // Connect to private stream
  logger.info("Connecting to private stream...");
  const privateResult = await executionAdapter.connectPrivateStream();
  if (privateResult.isErr()) {
    dashboard.pushEvent(LogLevel.WARN, "private stream connect failed; using REST fallback", privateResult.error);
    logger.warn("Failed to connect to private stream, using REST fallback", privateResult.error);
  } else {
    dashboard.pushEvent(LogLevel.INFO, "private stream connected");
  }

  // Re-sync open orders after all connections are established
  // This catches any orders that might have been placed between initial sync and stream connection
  await syncOpenOrders("post-connect");

  // Tick loop
  let lastTickMs = 0;
  let lastHeartbeatMs = 0;

  const tickLoop = async (): Promise<void> => {
    const nowMs = Date.now();

    // Throttle ticks
    if (nowMs - lastTickMs < env.TICK_INTERVAL_MS) {
      return;
    }

    // Check if we have valid market data
    if (!marketDataCache.hasValidData()) {
      // Disable overlay when data is stale
      paramsOverlay.setActive(false);
      return;
    }

    lastTickMs = nowMs;

    // Enable/disable overlay based on mode (disable during PAUSE for safety)
    paramsOverlay.setActive(state.mode !== "PAUSE");

    // Compute effective params with overlay applied (db params + tighten adjustment)
    const effectiveParams = paramsOverlay.computeEffectiveParams(params, nowMs);
    const overlayState = paramsOverlay.getState();

    try {
      const output = await executeTick(
        {
          marketDataCache,
          orderTracker,
          positionTracker,
          executionPort: executionAdapter,
          params: effectiveParams, // Use effective params for order calculation
          onPhase: phase => {
            dashboard.enterPhase(phase, nowMs);
          },
          onTickDebug: ({
            nowMs,
            snapshot,
            features,
            output,
            stateBefore,
            stateAfter,
            plannedActions,
            targetQuote,
          }) => {
            dashboard.setTick({
              nowMs,
              snapshot,
              features,
              output,
              stateBefore,
              stateAfter,
              paramsSetId: currentParamsSetId,
              dbParams: params, // Original DB params
              effectiveParams, // Params with overlay applied
              overlayState, // Overlay state for display
              plannedActions,
              targetQuote,
              orders: orderTracker.getActiveOrders(),
              position: {
                size: positionTracker.getPosition().size,
                entryPrice: positionTracker.getEntryPrice(),
                unrealizedPnl: positionTracker.getUnrealizedPnl(),
                lastUpdateMs: positionTracker.getLastUpdateMs(),
              },
              funding: marketDataCache.getFunding(),
            });
          },
          onAction: ({ phase, action, error }) => {
            dashboard.onAction(phase, action, { error });
          },
          onStateChange: ({ nextState, reasonCodes, intents, debug }) => {
            dashboard.pushEvent(
              LogLevel.INFO,
              `STATE ${state.mode} -> ${nextState.mode} reasons=[${reasonCodes.join(",")}] intents=[${intents
                .map(i => i.type)
                .join(",")}]`,
              {
                dataAgeMs: debug.dataAgeMs,
                midPx: debug.midPx,
                spreadBps: debug.spreadBps,
                realizedVol10s: debug.realizedVol10s,
                tradeImbalance1s: debug.tradeImbalance1s,
                markIndexDivBps: debug.markIndexDivBps,
                liqCount10s: debug.liqCount10s,
                positionSize: debug.positionSize,
                activeOrders: debug.activeOrders,
                pauseRemainingMs:
                  nextState.pauseUntilMs !== undefined ? Math.max(0, nextState.pauseUntilMs - nowMs) : null,
                modeForMs: nowMs - state.modeSinceMs,
              },
            );

            logger.info("State changed", {
              from: state.mode,
              to: nextState.mode,
              reasonCodes,
              intents: intents.map(i => i.type),
              dataAgeMs: debug.dataAgeMs,
              midPx: debug.midPx,
              spreadBps: debug.spreadBps,
              realizedVol10s: debug.realizedVol10s,
              tradeImbalance1s: debug.tradeImbalance1s,
              markIndexDivBps: debug.markIndexDivBps,
              liqCount10s: debug.liqCount10s,
              positionSize: debug.positionSize,
              activeOrders: debug.activeOrders,
              pauseRemainingMs: nextState.pauseUntilMs ? Math.max(0, nextState.pauseUntilMs - nowMs) : null,
              modeForMs: nowMs - state.modeSinceMs,
            });
          },
        },
        state,
      );

      state = output.nextState;

      // Heartbeat (helps distinguish "quiet" vs "stuck")
      if (nowMs - lastHeartbeatMs >= 30_000) {
        lastHeartbeatMs = nowMs;
        const snapshot = marketDataCache.getSnapshot(nowMs);
        logger.info("Executor heartbeat", {
          mode: state.mode,
          positionSize: positionTracker.getPosition().size,
          activeOrders: orderTracker.getActiveOrders().length,
          lastQuoteAgeMs: state.lastQuoteMs !== undefined ? nowMs - state.lastQuoteMs : null,
          dataAgeMs: snapshot.lastUpdateMs > 0 ? nowMs - snapshot.lastUpdateMs : null,
          pauseRemainingMs: state.pauseUntilMs !== undefined ? Math.max(0, state.pauseUntilMs - nowMs) : null,
          modeForMs: nowMs - state.modeSinceMs,
        });
      }
    } catch (error) {
      logger.error("Tick error", error);
    }
  };

  // Run tick loop
  const tickInterval = setInterval(() => {
    void tickLoop();
  }, env.TICK_INTERVAL_MS);

  // State persistence loop (Requirement 4.11)
  const persistInterval = setInterval(() => {
    void (async () => {
      dashboard.enterPhase("PERSIST");
      const result = await strategyStateRepo.save({
        ts: new Date(),
        exchange: env.EXCHANGE,
        symbol: env.SYMBOL,
        mode: state.mode,
        modeSince: new Date(state.modeSinceMs),
        pauseUntil: state.pauseUntilMs !== undefined ? new Date(state.pauseUntilMs) : null,
        paramsSetId: currentParamsSetId,
      });

      if (result.isErr()) {
        logger.error("Failed to persist state", result.error);
      } else {
        logger.debug("State persisted", { mode: state.mode });
      }

      // Persist latest_position (best-effort, 1 row per (exchange, symbol))
      const posResult = await positionRepo.upsertLatestPosition(
        buildLatestPositionState({
          exchange: env.EXCHANGE,
          symbol: env.SYMBOL,
          positionTracker,
          nowMs: Date.now(),
        }),
      );
      if (posResult.isErr()) {
        logger.error("Failed to upsert latest_position", posResult.error);
      }
      dashboard.enterPhase("IDLE");
    })();
  }, env.STATE_PERSIST_INTERVAL_MS);

  /**
   * Params refresh loop: update in-memory params when DB current params changes.
   * Uses both ID and content signature for change detection (catches UPDATEs too).
   */
  let lastParamsId: string | null = currentParamsSetId;
  let lastParamsSig: string = computeParamsSignature(params);
  const paramsRefreshInterval = setInterval(() => {
    if (!env.PARAMS_REFRESH_ENABLED) return;
    void (async () => {
      const result = await proposalRepo.getCurrentParams(env.EXCHANGE, env.SYMBOL);
      if (result.isErr()) {
        logger.debug("Params refresh failed", result.error);
        return;
      }
      const dbParams = result.value;
      const newParams = toCoreParams(dbParams);
      const newSig = computeParamsSignature(newParams);

      // Detect change by ID or content signature
      const idChanged = dbParams.id !== lastParamsId;
      const sigChanged = newSig !== lastParamsSig;

      if (idChanged || sigChanged) {
        const changeReason = idChanged ? "id" : "content";
        lastParamsId = dbParams.id;
        lastParamsSig = newSig;
        currentParamsSetId = dbParams.id;

        // Detect which keys changed (use canonical key list to avoid metadata fields)
        const changedKeys: string[] = [];
        for (const key of ALLOWED_PARAM_KEYS) {
          if (String(newParams[key]) !== String(params[key])) {
            changedKeys.push(key);
          }
        }

        params = newParams;

        // Reset overlay when base params change (start fresh)
        paramsOverlay.reset();

        // Notify dashboard with highlighted params change
        dashboard.notifyParamsChange({
          source: "db_refresh",
          paramsSetId: dbParams.id,
          changedKeys: changedKeys.length > 0 ? changedKeys : undefined,
        });

        logger.info("Params updated from DB", {
          paramsSetId: dbParams.id,
          changeReason,
          changedKeys,
          baseHalfSpreadBps: newParams.baseHalfSpreadBps,
        });
      }
    })();
  }, env.PARAMS_REFRESH_INTERVAL_MS);

  /**
   * Proposal apply loop: check for pending proposals and apply them on configured boundaries.
   */
  const proposalApplyInterval = setInterval(() => {
    if (!env.PROPOSAL_APPLY_ENABLED) return;
    void (async () => {
      const nowMs = Date.now();
      const timing = {
        boundaryMinutes: env.PROPOSAL_APPLY_BOUNDARY_MINUTES,
        graceSeconds: env.PROPOSAL_APPLY_BOUNDARY_GRACE_SECONDS,
      };

      // Avoid extra DB load when not near a boundary.
      if (!isAtTimeBoundary(nowMs, timing)) return;

      // Operational context (best-effort)
      const snapshot = marketDataCache.getSnapshot(nowMs);
      const dataStale =
        !marketDataCache.hasValidData() || nowMs - snapshot.lastUpdateMs > env.PROPOSAL_APPLY_DATA_STALE_MS;

      // Last complete hour window (UTC)
      const now = new Date();
      const windowEnd = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), 0, 0, 0),
      );
      const windowStart = new Date(windowEnd.getTime() - 3600_000);

      let pauseCountLastHour = 0;
      let markout10sP50: number | undefined = undefined;
      const aggResult = await metricsRepo.getHourlyAggregation(env.EXCHANGE, env.SYMBOL, windowStart, windowEnd);
      if (aggResult.isOk()) {
        pauseCountLastHour = aggResult.value.pauseCount;
        markout10sP50 = aggResult.value.markout10sP50 ?? undefined;
      }

      const proposalResult = await processPendingProposals(
        proposalRepo,
        {
          exchange: env.EXCHANGE,
          symbol: env.SYMBOL,
          maxPauseCountForApply: env.PROPOSAL_APPLY_MAX_PAUSE_COUNT_LAST_HOUR,
          minMarkout10sP50ForApply: env.PROPOSAL_APPLY_MIN_MARKOUT10S_P50_BPS,
        },
        {
          pauseCountLastHour,
          dataStale,
          markout10sP50,
          dbWriteFailures: false,
          exchangeErrors: false,
        },
        nowMs,
        timing,
      );

      if (proposalResult.type === "applied") {
        // Apply immediately in-memory so next tick uses updated params.
        const newCoreParams = toCoreParams(proposalResult.params);
        params = newCoreParams;
        currentParamsSetId = proposalResult.params.id;
        lastParamsId = proposalResult.params.id;

        // Reset overlay so derived values (e.g., tightenBps) are consistent with new base params
        paramsOverlay.reset();

        // Notify dashboard with highlighted params change
        dashboard.notifyParamsChange({
          source: "proposal_apply",
          paramsSetId: proposalResult.params.id,
          changedKeys: proposalResult.changedKeys.length > 0 ? proposalResult.changedKeys : undefined,
        });

        logger.info("Proposal applied; params updated", {
          paramsSetId: proposalResult.params.id,
          changedKeys: proposalResult.changedKeys,
        });
      } else if (proposalResult.type === "rejected") {
        // Notify dashboard about rejection
        dashboard.notifyParamsChange({
          source: "proposal_reject",
          rejectReason: proposalResult.reason,
        });

        logger.warn("Proposal rejected", {
          proposalId: proposalResult.proposalId,
          reason: proposalResult.reason,
        });
      }
    })();
  }, env.PROPOSAL_APPLY_POLL_INTERVAL_MS);

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    logger.info("Shutting down...");

    clearInterval(tickInterval);
    clearInterval(persistInterval);
    clearInterval(paramsRefreshInterval);
    clearInterval(proposalApplyInterval);

    // Cancel all orders before shutdown
    await executionAdapter.cancelAllOrders(env.SYMBOL);

    // Flush remaining events
    {
      const stopResult = await eventRepo.stop();
      if (stopResult.isErr()) {
        logger.error("Failed to flush events on shutdown", stopResult.error);
      }
    }

    await marketDataAdapter.disconnect();
    await executionAdapter.disconnectPrivateStream();
    await db.$client.end();

    dashboard.stop();
    logger.info("Shutdown complete");
    process.exitCode = 0;
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  logger.info("Executor running");
}

// Run
main().catch((error: unknown) => {
  logger.error("Fatal error", error);
  process.exitCode = 1;
});
