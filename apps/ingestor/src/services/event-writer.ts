/**
 * Event Writer Service
 *
 * Requirements: 3.2, 4.10
 * - Buffers market data events for batch insert
 * - Flushes to DB on interval (non-blocking)
 */

import type { Db } from "@agentic-mm-bot/db";
import { mdBbo, mdPrice, mdTrade } from "@agentic-mm-bot/db";
import { logger } from "@agentic-mm-bot/utils";

/**
 * Event Writer - Buffers and batch-writes market data to DB
 */
export class EventWriter {
  private readonly db: Db;
  private readonly bboBuffer: (typeof mdBbo.$inferInsert)[] = [];
  private readonly tradeBuffer: (typeof mdTrade.$inferInsert)[] = [];
  private readonly priceBuffer: (typeof mdPrice.$inferInsert)[] = [];
  private flushIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(db: Db) {
    this.db = db;
  }

  /**
   * Add BBO event to buffer
   */
  addBbo(event: typeof mdBbo.$inferInsert): void {
    this.bboBuffer.push(event);
  }

  /**
   * Add Trade event to buffer
   */
  addTrade(event: typeof mdTrade.$inferInsert): void {
    this.tradeBuffer.push(event);
  }

  /**
   * Add Price event to buffer
   */
  addPrice(event: typeof mdPrice.$inferInsert): void {
    this.priceBuffer.push(event);
  }

  /**
   * Get current buffer sizes
   */
  getBufferSizes(): { bbo: number; trade: number; price: number } {
    return {
      bbo: this.bboBuffer.length,
      trade: this.tradeBuffer.length,
      price: this.priceBuffer.length,
    };
  }

  /**
   * Flush all buffers to DB
   */
  async flush(): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.bboBuffer.length > 0) {
      const toInsert = this.bboBuffer.splice(0, this.bboBuffer.length);
      promises.push(
        this.db
          .insert(mdBbo)
          .values(toInsert)
          .then(() => {
            logger.debug("Flushed BBO buffer", { count: toInsert.length });
          })
          .catch((error: unknown) => {
            logger.error("Failed to flush BBO buffer", { error });
          }),
      );
    }

    if (this.tradeBuffer.length > 0) {
      const toInsert = this.tradeBuffer.splice(0, this.tradeBuffer.length);
      promises.push(
        this.db
          .insert(mdTrade)
          .values(toInsert)
          .then(() => {
            logger.debug("Flushed trade buffer", { count: toInsert.length });
          })
          .catch((error: unknown) => {
            logger.error("Failed to flush trade buffer", { error });
          }),
      );
    }

    if (this.priceBuffer.length > 0) {
      const toInsert = this.priceBuffer.splice(0, this.priceBuffer.length);
      promises.push(
        this.db
          .insert(mdPrice)
          .values(toInsert)
          .then(() => {
            logger.debug("Flushed price buffer", { count: toInsert.length });
          })
          .catch((error: unknown) => {
            logger.error("Failed to flush price buffer", { error });
          }),
      );
    }

    await Promise.allSettled(promises);
  }

  /**
   * Start periodic flush interval
   */
  startFlushInterval(intervalMs: number): void {
    if (this.flushIntervalId) {
      clearInterval(this.flushIntervalId);
    }
    this.flushIntervalId = setInterval(() => {
      void this.flush();
    }, intervalMs);
  }

  /**
   * Stop periodic flush and perform final flush
   */
  async stop(): Promise<void> {
    if (this.flushIntervalId) {
      clearInterval(this.flushIntervalId);
      this.flushIntervalId = null;
    }
    await this.flush();
  }
}
