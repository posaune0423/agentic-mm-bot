/**
 * Ingestor Main Entry Point
 *
 * Requirements: 3.1-3.6
 * - Subscribe to market data (BBO, Trades, Mark, Index, Funding)
 * - Append to md_* tables with throttling
 * - Upsert latest_top periodically (not every BBO)
 * - Throttle BBO writes by time and mid change
 */

import { config } from "dotenv";
import { resolve } from "path";

// Load .env from project root (three levels up from apps/ingestor)
config({ path: resolve(process.cwd(), "../../.env") });

import {
  ExtendedMarketDataAdapter,
  type BboEvent,
  type FundingRateEvent,
  type PriceEvent,
  type TradeEvent,
} from "@agentic-mm-bot/adapters";
import { getDb } from "@agentic-mm-bot/db";
import { logger } from "@agentic-mm-bot/utils";

import { env } from "./env";
import { BboThrottler, EventWriter, LatestStateManager } from "./services";
import type { IngestorMetrics } from "./types";

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
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
  const bboThrottler = new BboThrottler(
    env.BBO_THROTTLE_MS,
    env.BBO_MIN_CHANGE_BPS,
  );
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

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleBbo = (event: BboEvent): void => {
    metrics.bboReceived++;

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
    if (bboThrottler.shouldWrite(event.ts.getTime(), mid)) {
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

  marketDataAdapter.onEvent((event) => {
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

  // ============================================================================
  // Start Services
  // ============================================================================

  // Start periodic flush (1 second)
  eventWriter.startFlushInterval(1000);

  // Start periodic latest_top upsert
  latestStateManager.startUpsertInterval(env.LATEST_TOP_UPSERT_INTERVAL_MS);

  // Metrics logging (every 30 seconds)
  const metricsInterval = setInterval(() => {
    const bufferSizes = eventWriter.getBufferSizes();
    metrics.bboBufferSize = bufferSizes.bbo;
    metrics.tradeBufferSize = bufferSizes.trade;
    metrics.priceBufferSize = bufferSizes.price;

    logger.info("Ingestor metrics", metrics);
  }, 30000);

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

    clearInterval(metricsInterval);

    // Stop services (includes final flush/upsert)
    await eventWriter.stop();
    await latestStateManager.stop();

    await marketDataAdapter.disconnect();
    await db.$client.end();

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

main().catch((error) => {
  logger.error("Fatal error", error);
  process.exit(1);
});
