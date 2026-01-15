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
  private readonly deadLetterBuffer: DeadLetterEntry[] = [];
  private flushIntervalId: ReturnType<typeof setInterval> | null = null;
  private flushInFlight: Promise<void> | null = null;
  private readonly retryBaseDelayMs: number;

  constructor(db: Db, opts?: { retryBaseDelayMs?: number }) {
    this.db = db;
    this.retryBaseDelayMs = opts?.retryBaseDelayMs ?? 100;
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
   * Flush failures are captured for later processing.
   * NOTE: This buffer grows unbounded in the current MVP; downstream processing
   * should drain/ship it.
   */
  getDeadLetterSize(): number {
    return this.deadLetterBuffer.length;
  }

  private async flushWithRetry(table: MdTable, events: readonly MdInsert[], maxRetries = 3): Promise<void> {
    if (events.length === 0) return;

    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (table === mdBbo) {
          await this.db.insert(mdBbo).values(events as (typeof mdBbo.$inferInsert)[]);
        } else if (table === mdTrade) {
          await this.db.insert(mdTrade).values(events as (typeof mdTrade.$inferInsert)[]);
        } else {
          await this.db.insert(mdPrice).values(events as (typeof mdPrice.$inferInsert)[]);
        }
        return;
      } catch (error: unknown) {
        lastError = error;

        if (attempt >= maxRetries) break;

        const delayMs = this.getRetryDelayMs(attempt);
        logger.warn("Flush insert failed; retrying", {
          table: getTableName(table),
          attempt,
          maxRetries,
          count: events.length,
          delayMs,
          error,
        });

        await sleep(delayMs);
      }
    }

    throw lastError;
  }

  /**
   * Flush all buffers to DB
   */
  async flush(): Promise<void> {
    if (this.flushInFlight) {
      await this.flushInFlight;
      return;
    }

    this.flushInFlight = this.flushOnce();
    try {
      await this.flushInFlight;
    } finally {
      this.flushInFlight = null;
    }
  }

  private async flushOnce(): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.bboBuffer.length > 0) {
      const toInsert = this.bboBuffer.slice(0, this.bboBuffer.length);
      promises.push(
        this.flushWithRetry(mdBbo, toInsert)
          .then(() => {
            this.bboBuffer.splice(0, toInsert.length);
            logger.debug("Flushed BBO buffer", { count: toInsert.length });
          })
          .catch((error: unknown) => {
            const failed = this.bboBuffer.splice(0, toInsert.length);
            this.deadLetterBuffer.push({
              table: "mdBbo",
              events: failed,
              error,
              failedAt: new Date(),
            });
            logger.error("Failed to flush BBO buffer; moved to dead letter", {
              count: failed.length,
              error,
            });
          }),
      );
    }

    if (this.tradeBuffer.length > 0) {
      const toInsert = this.tradeBuffer.slice(0, this.tradeBuffer.length);
      promises.push(
        this.flushWithRetry(mdTrade, toInsert)
          .then(() => {
            this.tradeBuffer.splice(0, toInsert.length);
            logger.debug("Flushed trade buffer", { count: toInsert.length });
          })
          .catch((error: unknown) => {
            const failed = this.tradeBuffer.splice(0, toInsert.length);
            this.deadLetterBuffer.push({
              table: "mdTrade",
              events: failed,
              error,
              failedAt: new Date(),
            });
            logger.error("Failed to flush trade buffer; moved to dead letter", {
              count: failed.length,
              error,
            });
          }),
      );
    }

    if (this.priceBuffer.length > 0) {
      const toInsert = this.priceBuffer.slice(0, this.priceBuffer.length);
      promises.push(
        this.flushWithRetry(mdPrice, toInsert)
          .then(() => {
            this.priceBuffer.splice(0, toInsert.length);
            logger.debug("Flushed price buffer", { count: toInsert.length });
          })
          .catch((error: unknown) => {
            const failed = this.priceBuffer.splice(0, toInsert.length);
            this.deadLetterBuffer.push({
              table: "mdPrice",
              events: failed,
              error,
              failedAt: new Date(),
            });
            logger.error("Failed to flush price buffer; moved to dead letter", {
              count: failed.length,
              error,
            });
          }),
      );
    }

    await Promise.allSettled(promises);
  }

  private getRetryDelayMs(attempt: number): number {
    // attempt: 1 -> 100ms, 2 -> 200ms, 3 -> 400ms ...
    const base = this.retryBaseDelayMs * 2 ** (attempt - 1);
    // up to 25% jitter
    const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(base * 0.25)));
    return base + jitter;
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

type MdTable = typeof mdBbo | typeof mdTrade | typeof mdPrice;

type MdInsert = typeof mdBbo.$inferInsert | typeof mdTrade.$inferInsert | typeof mdPrice.$inferInsert;

type DeadLetterEntry =
  | {
      table: "mdBbo";
      events: (typeof mdBbo.$inferInsert)[];
      error: unknown;
      failedAt: Date;
    }
  | {
      table: "mdTrade";
      events: (typeof mdTrade.$inferInsert)[];
      error: unknown;
      failedAt: Date;
    }
  | {
      table: "mdPrice";
      events: (typeof mdPrice.$inferInsert)[];
      error: unknown;
      failedAt: Date;
    };

function getTableName(table: MdTable): DeadLetterEntry["table"] {
  if (table === mdBbo) return "mdBbo";
  if (table === mdTrade) return "mdTrade";
  return "mdPrice";
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
