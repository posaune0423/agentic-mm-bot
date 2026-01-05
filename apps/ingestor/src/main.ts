/**
 * Ingestor Main Entry Point
 *
 * Requirements: 3.1-3.6
 * - Subscribe to market data
 * - Append to md_* tables
 * - Upsert latest_top
 * - Throttle BBO writes
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ExtendedMarketDataAdapter, type BboEvent, type PriceEvent, type TradeEvent } from "@agentic-mm-bot/adapters";
import { latestTop, mdBbo, mdPrice, mdTrade } from "@agentic-mm-bot/db";
import { configureLogger, logger } from "@agentic-mm-bot/utils";
import { eq, and } from "drizzle-orm";

import { loadEnv } from "./env";

/**
 * BBO Throttler - Limits BBO write frequency
 */
class BboThrottler {
  private lastWriteMs: number = 0;
  private throttleMs: number;

  constructor(throttleMs: number) {
    this.throttleMs = throttleMs;
  }

  shouldWrite(nowMs: number): boolean {
    if (nowMs - this.lastWriteMs >= this.throttleMs) {
      this.lastWriteMs = nowMs;
      return true;
    }
    return false;
  }
}

async function main(): Promise<void> {
  const env = loadEnv();

  configureLogger({ logLevel: env.LOG_LEVEL });
  logger.info("Starting ingestor", { exchange: env.EXCHANGE, symbol: env.SYMBOL });

  // Initialize database
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const db = drizzle(pool);

  // Initialize adapter
  const marketDataAdapter = new ExtendedMarketDataAdapter({
    network: env.EXTENDED_NETWORK,
    apiKey: env.EXTENDED_API_KEY,
    starkPrivateKey: env.EXTENDED_STARK_PRIVATE_KEY,
    starkPublicKey: env.EXTENDED_STARK_PUBLIC_KEY,
    vaultId: env.EXTENDED_VAULT_ID,
  });

  // BBO throttler
  const bboThrottler = new BboThrottler(env.BBO_THROTTLE_MS);

  // Batch writers for async persistence
  const bboBuffer: (typeof mdBbo.$inferInsert)[] = [];
  const tradeBuffer: (typeof mdTrade.$inferInsert)[] = [];
  const priceBuffer: (typeof mdPrice.$inferInsert)[] = [];

  // Flush buffers periodically
  const flushBuffers = async (): Promise<void> => {
    if (bboBuffer.length > 0) {
      const toInsert = bboBuffer.splice(0, bboBuffer.length);
      await db.insert(mdBbo).values(toInsert);
      logger.debug("Flushed BBO buffer", { count: toInsert.length });
    }

    if (tradeBuffer.length > 0) {
      const toInsert = tradeBuffer.splice(0, tradeBuffer.length);
      await db.insert(mdTrade).values(toInsert);
      logger.debug("Flushed trade buffer", { count: toInsert.length });
    }

    if (priceBuffer.length > 0) {
      const toInsert = priceBuffer.splice(0, priceBuffer.length);
      await db.insert(mdPrice).values(toInsert);
      logger.debug("Flushed price buffer", { count: toInsert.length });
    }
  };

  // Flush interval
  const flushInterval = setInterval(() => {
    void flushBuffers();
  }, 1000);

  // Handle BBO event
  const handleBbo = async (event: BboEvent): Promise<void> => {
    const mid = (parseFloat(event.bestBidPx) + parseFloat(event.bestAskPx)) / 2;

    // Throttle md_bbo writes
    if (bboThrottler.shouldWrite(event.ts.getTime())) {
      bboBuffer.push({
        ts: event.ts,
        exchange: event.exchange,
        symbol: event.symbol,
        bestBidPx: event.bestBidPx,
        bestBidSz: event.bestBidSz,
        bestAskPx: event.bestAskPx,
        bestAskSz: event.bestAskSz,
        midPx: mid.toString(),
        seq: event.seq,
        rawJson: event.raw,
      });
    }

    // Always upsert latest_top
    await db
      .insert(latestTop)
      .values({
        exchange: event.exchange,
        symbol: event.symbol,
        ts: event.ts,
        bestBidPx: event.bestBidPx,
        bestBidSz: event.bestBidSz,
        bestAskPx: event.bestAskPx,
        bestAskSz: event.bestAskSz,
        midPx: mid.toString(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [latestTop.exchange, latestTop.symbol],
        set: {
          ts: event.ts,
          bestBidPx: event.bestBidPx,
          bestBidSz: event.bestBidSz,
          bestAskPx: event.bestAskPx,
          bestAskSz: event.bestAskSz,
          midPx: mid.toString(),
          updatedAt: new Date(),
        },
      });
  };

  // Handle Trade event
  const handleTrade = (event: TradeEvent): void => {
    tradeBuffer.push({
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

  // Handle Price event
  const handlePrice = async (event: PriceEvent): Promise<void> => {
    priceBuffer.push({
      ts: event.ts,
      exchange: event.exchange,
      symbol: event.symbol,
      markPx: event.markPx,
      indexPx: event.indexPx,
      rawJson: event.raw,
    });

    // Update latest_top with mark/index
    await db
      .update(latestTop)
      .set({
        markPx: event.markPx,
        indexPx: event.indexPx,
        updatedAt: new Date(),
      })
      .where(and(eq(latestTop.exchange, event.exchange), eq(latestTop.symbol, event.symbol)));
  };

  // Set up event handlers
  marketDataAdapter.onEvent(event => {
    switch (event.type) {
      case "bbo":
        void handleBbo(event);
        break;
      case "trade":
        handleTrade(event);
        break;
      case "price":
        void handlePrice(event);
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

  // Connect
  logger.info("Connecting to market data...");
  const connectResult = await marketDataAdapter.connect();
  if (connectResult.isErr()) {
    logger.error("Failed to connect to market data", connectResult.error);
    process.exit(1);
  }

  // Subscribe
  marketDataAdapter.subscribe({
    exchange: env.EXCHANGE,
    symbol: env.SYMBOL,
    channels: ["bbo", "trades", "prices"],
  });

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    logger.info("Shutting down...");

    clearInterval(flushInterval);
    await flushBuffers();

    await marketDataAdapter.disconnect();
    await pool.end();

    logger.info("Shutdown complete");
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
