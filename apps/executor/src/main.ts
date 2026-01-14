/**
 * Executor Main Entry Point
 *
 * Requirements: 4.1-4.11
 * - Composition root for executor
 * - Event-driven tick loop
 * - State persistence (4.11)
 * - Non-blocking event logging (4.10)
 */

import { config } from "dotenv";
import { resolve } from "path";

// Load .env from project root (three levels up from apps/executor)
config({ path: resolve(process.cwd(), "../../.env") });

import { createInitialState, type StrategyParams, type StrategyState } from "@agentic-mm-bot/core";
import { ExtendedExecutionAdapter, ExtendedMarketDataAdapter, initWasm } from "@agentic-mm-bot/adapters";
import { getDb } from "@agentic-mm-bot/db";
import { logger } from "@agentic-mm-bot/utils";

import { env } from "./env";
import { MarketDataCache } from "./services/market-data-cache";
import { OrderTracker } from "./services/order-tracker";
import { PositionTracker } from "./services/position-tracker";
import { ExecutorCliDashboard } from "./services/cli-dashboard";
import { executeTick } from "./usecases/decision-cycle";
import { createPostgresStrategyStateRepository, createPostgresEventRepository } from "@agentic-mm-bot/repositories";

/**
 * Main executor function
 */
async function main(): Promise<void> {
  // If TTY dashboard is enabled, suppress normal logs to avoid flicker.
  // (Dashboard shows state/orders/actions; keep ERROR logs for debugging.)
  const dashboardEnabled = env.EXECUTOR_DASHBOARD && Boolean(process.stdout.isTTY);
  if (dashboardEnabled) {
    process.env.LOG_LEVEL = "ERROR";
  }

  // Initialize WASM first
  try {
    await initWasm();
    if (!dashboardEnabled) logger.info("WASM initialized successfully (signer)");
  } catch (error) {
    logger.error("Failed to initialize WASM", error);
    process.exit(1);
  }

  if (!dashboardEnabled) logger.info("Starting executor", { exchange: env.EXCHANGE, symbol: env.SYMBOL });

  // Initialize database connection
  const db = getDb(env.DATABASE_URL);

  // Initialize repositories
  const strategyStateRepo = createPostgresStrategyStateRepository(db);
  const eventRepo = createPostgresEventRepository(db);

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

  // CLI dashboard (TTY UI)
  const dashboard = new ExecutorCliDashboard({
    enabled: env.EXECUTOR_DASHBOARD,
    exchange: env.EXCHANGE,
    symbol: env.SYMBOL,
  });
  dashboard.start();
  dashboard.pushEvent("INFO", "executor started", { exchange: env.EXCHANGE, symbol: env.SYMBOL });

  // Sync open orders on startup
  if (!dashboardEnabled) logger.info("Syncing open orders...");
  const openOrdersResult = await executionAdapter.getOpenOrders(env.SYMBOL);
  if (openOrdersResult.isOk()) {
    orderTracker.syncFromOpenOrders(openOrdersResult.value);
    dashboard.pushEvent("INFO", `synced open orders: ${openOrdersResult.value.length}`);
    if (!dashboardEnabled) logger.info("Synced open orders", { count: openOrdersResult.value.length });
  } else {
    dashboard.pushEvent("WARN", "failed to sync open orders; proceeding with empty tracker", openOrdersResult.error);
    if (!dashboardEnabled)
      logger.warn("Failed to sync open orders, proceeding with empty tracker", openOrdersResult.error);
  }

  // TODO: Load from DB or use defaults
  const params: StrategyParams = {
    baseHalfSpreadBps: "10",
    volSpreadGain: "1",
    toxSpreadGain: "1",
    quoteSizeUsd: "10", // $10 per order
    refreshIntervalMs: 1000,
    staleCancelMs: 5000,
    maxInventory: "1",
    inventorySkewGain: "5",
    pauseMarkIndexBps: "50",
    pauseLiqCount10s: 3,
  };

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
      case "connected":
        dashboard.setConnectionStatus("connected");
        if (!dashboardEnabled) logger.info("Market data connected");
        break;
      case "disconnected":
        dashboard.setConnectionStatus("disconnected");
        if (!dashboardEnabled) logger.warn("Market data disconnected");
        break;
      case "reconnecting":
        dashboard.setConnectionStatus("reconnecting", event.reason);
        if (!dashboardEnabled) logger.info("Market data reconnecting", { reason: event.reason });
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
          paramsSetId: params.baseHalfSpreadBps, // TODO: Use actual params ID
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
  if (!dashboardEnabled) logger.info("Connecting to market data...");
  const connectResult = await marketDataAdapter.connect();
  if (connectResult.isErr()) {
    logger.error("Failed to connect to market data", connectResult.error);
    process.exit(1);
  }
  dashboard.pushEvent("INFO", "market data connected");

  // Subscribe to market data
  marketDataAdapter.subscribe({
    exchange: env.EXCHANGE,
    symbol: env.SYMBOL,
    channels: ["bbo", "trades", "prices"],
  });

  // Connect to private stream
  if (!dashboardEnabled) logger.info("Connecting to private stream...");
  const privateResult = await executionAdapter.connectPrivateStream();
  if (privateResult.isErr()) {
    dashboard.pushEvent("WARN", "private stream connect failed; using REST fallback", privateResult.error);
    if (!dashboardEnabled) logger.warn("Failed to connect to private stream, using REST fallback", privateResult.error);
  }

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
      return;
    }

    lastTickMs = nowMs;

    try {
      const output = await executeTick(
        {
          marketDataCache,
          orderTracker,
          positionTracker,
          executionPort: executionAdapter,
          params,
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
              plannedActions,
              targetQuote,
              orders: orderTracker.getActiveOrders(),
              position: {
                size: positionTracker.getPosition().size,
                entryPrice: positionTracker.getEntryPrice(),
                unrealizedPnl: positionTracker.getUnrealizedPnl(),
                lastUpdateMs: positionTracker.getLastUpdateMs(),
              },
            });
          },
          onAction: ({ phase, action, error }) => {
            dashboard.onAction(phase, action, { error });
          },
          onStateChange: ({ nextState, reasonCodes, intents, debug }) => {
            dashboard.pushEvent(
              "INFO",
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
                pauseRemainingMs: nextState.pauseUntilMs ? Math.max(0, nextState.pauseUntilMs - nowMs) : null,
                modeForMs: nowMs - state.modeSinceMs,
              },
            );

            if (!dashboardEnabled) {
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
            }
          },
        },
        state,
      );

      state = output.nextState;

      // Heartbeat (helps distinguish "quiet" vs "stuck")
      if (nowMs - lastHeartbeatMs >= 30_000) {
        lastHeartbeatMs = nowMs;
        if (!dashboardEnabled) {
          const snapshot = marketDataCache.getSnapshot(nowMs);
          logger.info("Executor heartbeat", {
            mode: state.mode,
            positionSize: positionTracker.getPosition().size,
            activeOrders: orderTracker.getActiveOrders().length,
            lastQuoteAgeMs: state.lastQuoteMs ? nowMs - state.lastQuoteMs : null,
            dataAgeMs: snapshot.lastUpdateMs ? nowMs - snapshot.lastUpdateMs : null,
            pauseRemainingMs: state.pauseUntilMs ? Math.max(0, state.pauseUntilMs - nowMs) : null,
            modeForMs: nowMs - state.modeSinceMs,
          });
        }
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
      const result = await strategyStateRepo.save({
        ts: new Date(),
        exchange: env.EXCHANGE,
        symbol: env.SYMBOL,
        mode: state.mode,
        modeSince: state.modeSinceMs ? new Date(state.modeSinceMs) : null,
        pauseUntil: state.pauseUntilMs ? new Date(state.pauseUntilMs) : null,
        paramsSetId: null, // TODO: Use actual params ID
      });

      if (result.isErr()) {
        logger.error("Failed to persist state", result.error);
      } else {
        logger.debug("State persisted", { mode: state.mode });
      }
    })();
  }, env.STATE_PERSIST_INTERVAL_MS);

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    if (!dashboardEnabled) logger.info("Shutting down...");

    clearInterval(tickInterval);
    clearInterval(persistInterval);

    // Cancel all orders before shutdown
    await executionAdapter.cancelAllOrders(env.SYMBOL);

    // Flush remaining events
    await eventRepo.stop();

    await marketDataAdapter.disconnect();
    await executionAdapter.disconnectPrivateStream();
    await db.$client.end();

    dashboard.stop();
    if (!dashboardEnabled) logger.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  if (!dashboardEnabled) logger.info("Executor running");
}

// Run
main().catch(error => {
  logger.error("Fatal error", error);
  process.exit(1);
});
