/**
 * Ingestor Main Entry Point
 *
 * Requirements: 3.1-3.6
 * - Subscribe to market data (BBO, Trades, Mark, Index, Funding)
 * - Append to md_* tables with throttling
 * - Upsert latest_top periodically (not every BBO)
 * - Throttle BBO writes by time and mid change
 */

import {
  ExtendedMarketDataAdapter,
  type BboEvent,
  type FundingRateEvent,
  type PriceEvent,
  type TradeEvent,
} from "@agentic-mm-bot/adapters";
import { getDb } from "@agentic-mm-bot/db";
import { LogLevel, logger } from "@agentic-mm-bot/utils";

import { env } from "./env";
import { BboThrottler, EventWriter, IngestorCliDashboard, LatestStateManager } from "./services";
import type { IngestorMetrics } from "./types";

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  // Metrics
  const metrics: IngestorMetrics = {
    bboReceived: 0,
    bboWritten: 0,
    tradeReceived: 0,
    priceReceived: 0,
    fundingReceived: 0,
    bboBufferSize: 0,
    tradeBufferSize: 0,
    priceBufferSize: 0,
  };

  // CLI dashboard (TTY UI)
  const dashboard = new IngestorCliDashboard({
    enabled: env.INGESTOR_DASHBOARD,
    exchange: env.EXCHANGE,
    symbol: env.SYMBOL,
    initialMetrics: metrics,
    refreshMs: env.INGESTOR_DASHBOARD_REFRESH_MS,
    staleMs: env.INGESTOR_DASHBOARD_STALE_MS,
  });
  dashboard.start();
  dashboard.enterPhase("CONNECTING");
  dashboard.pushEvent(LogLevel.INFO, "ingestor started", { exchange: env.EXCHANGE, symbol: env.SYMBOL });

  // Market-data streaming does not require signing, so we intentionally skip signer WASM init.
  try {
    await ExtendedMarketDataAdapter.initialize();
    logger.info("WASM init skipped (market data only)");
  } catch (error) {
    logger.error("Failed to initialize WASM", error);
    process.exit(1);
  }

  logger.info("Starting ingestor", {
    exchange: env.EXCHANGE,
    symbol: env.SYMBOL,
    bboThrottleMs: env.BBO_THROTTLE_MS,
    bboMinChangeBps: env.BBO_MIN_CHANGE_BPS,
    latestTopUpsertIntervalMs: env.LATEST_TOP_UPSERT_INTERVAL_MS,
  });

  // Initialize database
  const db = getDb(env.DATABASE_URL);

  // Initialize services
  const bboThrottler = new BboThrottler(env.BBO_THROTTLE_MS, env.BBO_MIN_CHANGE_BPS);
  const eventWriter = new EventWriter(db);
  const latestStateManager = new LatestStateManager(db);

  // Initialize adapter
  const marketDataAdapter = new ExtendedMarketDataAdapter({
    network: env.EXTENDED_NETWORK,
    apiKey: env.EXTENDED_API_KEY,
    starkPrivateKey: env.EXTENDED_STARK_PRIVATE_KEY,
    starkPublicKey: env.EXTENDED_STARK_PUBLIC_KEY,
    vaultId: env.EXTENDED_VAULT_ID,
  });

  // Local debug-only counters (no secrets).
  let dbgFirstEventLogged = false;
  let lastDataEventAtMs = Date.now();
  let watchdogInFlight = false;
  let watchdogLastKickAtMs = 0;
  const watchdogThresholdMs = Math.max(env.INGESTOR_DASHBOARD_STALE_MS * 2, 6000);
  const watchdogCooldownMs = 15_000;
  let lastMetricsAtMs = Date.now();
  let lastMetrics = { bboReceived: 0, tradeReceived: 0, priceReceived: 0, fundingReceived: 0 };

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleBbo = (event: BboEvent): void => {
    metrics.bboReceived++;
    dashboard.enterPhase("RECEIVING");

    const mid = (parseFloat(event.bestBidPx) + parseFloat(event.bestAskPx)) / 2;
    const midStr = mid.toString();

    // Update latest state (always)
    latestStateManager.updateBbo(
      event.exchange,
      event.symbol,
      event.ts,
      event.bestBidPx,
      event.bestBidSz,
      event.bestAskPx,
      event.bestAskSz,
      midStr,
    );

    // Throttled md_bbo write
    const decision = bboThrottler.decide(event.ts.getTime(), mid);
    dashboard.onBbo(event, decision);

    if (decision.shouldWrite) {
      metrics.bboWritten++;
      eventWriter.addBbo({
        ts: event.ts,
        exchange: event.exchange,
        symbol: event.symbol,
        bestBidPx: event.bestBidPx,
        bestBidSz: event.bestBidSz,
        bestAskPx: event.bestAskPx,
        bestAskSz: event.bestAskSz,
        midPx: midStr,
        seq: event.seq,
        rawJson: event.raw,
      });
    }
  };

  const handleTrade = (event: TradeEvent): void => {
    metrics.tradeReceived++;
    dashboard.enterPhase("RECEIVING");
    dashboard.onTrade(event);

    eventWriter.addTrade({
      ts: event.ts,
      exchange: event.exchange,
      symbol: event.symbol,
      tradeId: event.tradeId,
      side: event.side,
      px: event.px,
      sz: event.sz,
      type: event.tradeType,
      seq: event.seq,
      rawJson: event.raw,
    });
  };

  const handlePrice = (event: PriceEvent): void => {
    metrics.priceReceived++;
    dashboard.enterPhase("RECEIVING");
    dashboard.onPrice(event);

    // Add to price buffer
    eventWriter.addPrice({
      ts: event.ts,
      exchange: event.exchange,
      symbol: event.symbol,
      markPx: event.markPx,
      indexPx: event.indexPx,
      rawJson: event.raw,
    });

    // Update latest state with mark/index
    if (event.priceType === "mark" && event.markPx) {
      latestStateManager.updateMarkPrice(event.markPx);
    }
    if (event.priceType === "index" && event.indexPx) {
      latestStateManager.updateIndexPrice(event.indexPx);
    }
  };

  const handleFunding = (event: FundingRateEvent): void => {
    metrics.fundingReceived++;
    dashboard.enterPhase("RECEIVING");
    dashboard.onFunding(event);

    // MVP: Just log funding rate, don't persist to DB
    // Future: Add md_funding_rate table
    logger.debug("Received funding rate", {
      symbol: event.symbol,
      fundingRate: event.fundingRate,
      ts: event.ts.toISOString(),
    });
  };

  // ============================================================================
  // Set up event handlers
  // ============================================================================

  marketDataAdapter.onEvent(event => {
    // Track last time we saw any data event (used by stale watchdog).
    if (event.type === "bbo" || event.type === "trade" || event.type === "price" || event.type === "funding") {
      lastDataEventAtMs = Date.now();
    }

    if (!dbgFirstEventLogged && (event.type === "bbo" || event.type === "trade" || event.type === "funding")) {
      dbgFirstEventLogged = true;
    } else if (
      !dbgFirstEventLogged &&
      (event.type === "connected" || event.type === "reconnecting" || event.type === "disconnected")
    ) {
      // Record connection events if we never see data events.
    }

    switch (event.type) {
      case "bbo":
        handleBbo(event);
        break;
      case "trade":
        handleTrade(event);
        break;
      case "price":
        handlePrice(event);
        break;
      case "funding":
        handleFunding(event);
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

  // ============================================================================
  // Start Services
  // ============================================================================

  // Start periodic flush (1 second)
  eventWriter.startFlushInterval(1000);

  // Start periodic latest_top upsert
  latestStateManager.startUpsertInterval(env.LATEST_TOP_UPSERT_INTERVAL_MS);

  // UI metrics + buffers refresh (every 1 second)
  const uiInterval = setInterval(() => {
    // Stale watchdog: if we stop receiving WS events for too long, force reconnect.
    // Uses this existing 1s interval (no new timers).
    const now = Date.now();
    const quietMs = now - lastDataEventAtMs;
    const cooldownOk = now - watchdogLastKickAtMs >= watchdogCooldownMs;
    if (!watchdogInFlight && cooldownOk && quietMs >= watchdogThresholdMs) {
      watchdogInFlight = true;
      watchdogLastKickAtMs = now;
      dashboard.setConnectionStatus("reconnecting", `stale_watchdog quiet=${quietMs}ms`);
      logger.warn("Stale watchdog: forcing market-data reconnect", {
        quietMs,
        watchdogThresholdMs,
        watchdogCooldownMs,
      });
      void (async () => {
        try {
          await marketDataAdapter.disconnect();
          await marketDataAdapter.connect();
        } catch (error) {
          logger.error("Stale watchdog reconnect failed", { error });
        } finally {
          watchdogInFlight = false;
        }
      })();
    }

    // When we appear stale, record counters/deltas once per ~5s to keep logs readable.
    const now2 = Date.now();
    const dt = Math.max(1, now2 - lastMetricsAtMs);
    const isStale = now2 - lastDataEventAtMs >= env.INGESTOR_DASHBOARD_STALE_MS;
    if (isStale && dt >= 5000) {
      const delta = {
        bbo: metrics.bboReceived - lastMetrics.bboReceived,
        trade: metrics.tradeReceived - lastMetrics.tradeReceived,
        price: metrics.priceReceived - lastMetrics.priceReceived,
        funding: metrics.fundingReceived - lastMetrics.fundingReceived,
      };
      logger.warn("Ingestor appears stale (no recent market-data events)", {
        symbol: env.SYMBOL,
        exchange: env.EXCHANGE,
        quietMs: now2 - lastDataEventAtMs,
        dt,
        delta,
        totals: {
          bbo: metrics.bboReceived,
          trade: metrics.tradeReceived,
          price: metrics.priceReceived,
          funding: metrics.fundingReceived,
        },
      });
      lastMetricsAtMs = now2;
      lastMetrics = {
        bboReceived: metrics.bboReceived,
        tradeReceived: metrics.tradeReceived,
        priceReceived: metrics.priceReceived,
        fundingReceived: metrics.fundingReceived,
      };
    }

    const bufferSizes = eventWriter.getBufferSizes();
    metrics.bboBufferSize = bufferSizes.bbo;
    metrics.tradeBufferSize = bufferSizes.trade;
    metrics.priceBufferSize = bufferSizes.price;
    dashboard.setMetrics(metrics);
    dashboard.setBuffers({ bufferSizes, deadLetterSize: eventWriter.getDeadLetterSize() });
  }, 1000);

  // ============================================================================
  // Connect and Subscribe
  // ============================================================================

  logger.info("Connecting to market data...");
  const connectResult = await marketDataAdapter.connect();
  if (connectResult.isErr()) {
    logger.error("Failed to connect to market data", connectResult.error);
    process.exit(1);
  }

  // Subscribe to all channels
  marketDataAdapter.subscribe({
    exchange: env.EXCHANGE,
    symbol: env.SYMBOL,
    channels: ["bbo", "trades", "prices", "funding"],
  });
  dashboard.enterPhase("SUBSCRIBED");

  logger.info("Subscribed to market data", {
    exchange: env.EXCHANGE,
    symbol: env.SYMBOL,
    channels: ["bbo", "trades", "prices", "funding"],
  });

  // ============================================================================
  // Graceful Shutdown
  // ============================================================================

  const shutdown = async (): Promise<void> => {
    logger.info("Shutting down...");

    clearInterval(uiInterval);

    // Stop services (includes final flush/upsert)
    await eventWriter.stop();
    await latestStateManager.stop();

    await marketDataAdapter.disconnect();
    await db.$client.end();

    dashboard.stop();
    logger.info("Shutdown complete", {
      bboReceived: metrics.bboReceived,
      bboWritten: metrics.bboWritten,
      tradeReceived: metrics.tradeReceived,
      priceReceived: metrics.priceReceived,
      fundingReceived: metrics.fundingReceived,
    });
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  logger.info("Ingestor running");
}

main().catch(error => {
  logger.error("Fatal error", error);
  process.exit(1);
});
