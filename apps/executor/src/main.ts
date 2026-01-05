/**
 * Executor Main Entry Point
 *
 * Requirements: 4.1-4.11
 * - Composition root for executor
 * - Event-driven tick loop
 * - State persistence (4.11)
 * - Non-blocking event logging (4.10)
 */

import { createInitialState, type StrategyParams, type StrategyState } from "@agentic-mm-bot/core";
import { ExtendedExecutionAdapter, ExtendedMarketDataAdapter } from "@agentic-mm-bot/adapters";
import { getDb } from "@agentic-mm-bot/db";
import { initLogger, logger } from "@agentic-mm-bot/utils";

import { env } from "./env";
import { MarketDataCache } from "./services/market-data-cache";
import { OrderTracker } from "./services/order-tracker";
import { PositionTracker } from "./services/position-tracker";
import { executeTick } from "./usecases/decision-cycle";
import { createPostgresStrategyStateRepository, createPostgresEventRepository } from "./repositories";

/**
 * Main executor function
 */
async function main(): Promise<void> {
  initLogger({ level: env.LOG_LEVEL });
  logger.info("Starting executor", { exchange: env.EXCHANGE, symbol: env.SYMBOL });

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

  // TODO: Load from DB or use defaults
  const params: StrategyParams = {
    baseHalfSpreadBps: "10",
    volSpreadGain: "1",
    toxSpreadGain: "1",
    quoteSizeBase: "0.01",
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
        logger.info("Market data connected");
        break;
      case "disconnected":
        logger.warn("Market data disconnected");
        break;
      case "reconnecting":
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
    process.exit(1);
  }

  // Subscribe to market data
  marketDataAdapter.subscribe({
    exchange: env.EXCHANGE,
    symbol: env.SYMBOL,
    channels: ["bbo", "trades", "prices"],
  });

  // Connect to private stream
  logger.info("Connecting to private stream...");
  const privateResult = await executionAdapter.connectPrivateStream();
  if (privateResult.isErr()) {
    logger.warn("Failed to connect to private stream, using REST fallback", privateResult.error);
  }

  // Tick loop
  let lastTickMs = 0;

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
          onStateChange: newState => {
            logger.info("State changed", {
              from: state.mode,
              to: newState.mode,
            });
          },
        },
        state,
      );

      state = output.nextState;
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
    logger.info("Shutting down...");

    clearInterval(tickInterval);
    clearInterval(persistInterval);

    // Cancel all orders before shutdown
    await executionAdapter.cancelAllOrders(env.SYMBOL);

    // Flush remaining events
    await eventRepo.stop();

    await marketDataAdapter.disconnect();
    await executionAdapter.disconnectPrivateStream();
    await db.$client.end();

    logger.info("Shutdown complete");
    process.exit(0);
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
main().catch(error => {
  logger.error("Fatal error", error);
  process.exit(1);
});
