/**
 * Postgres Event Repository
 *
 * Requirements: 4.4, 4.10
 * - Non-blocking async batch writes for events
 * - Queues events in memory and flushes periodically
 */

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ok, err, type Result } from "neverthrow";
import { exOrderEvent, exFill } from "@agentic-mm-bot/db";
import { logger } from "@agentic-mm-bot/utils";

import type {
  EventRepository,
  EventRepositoryError,
  OrderEventRecord,
  FillRecord,
} from "../interfaces/event-repository";

/**
 * Create a Postgres event repository with async batch writes
 */
export function createPostgresEventRepository(db: NodePgDatabase): EventRepository {
  const orderEventQueue: OrderEventRecord[] = [];
  const fillQueue: FillRecord[] = [];
  let flushIntervalId: ReturnType<typeof setInterval> | null = null;

  async function doFlush(): Promise<Result<void, EventRepositoryError>> {
    const eventsToFlush = [...orderEventQueue];
    const fillsToFlush = [...fillQueue];

    orderEventQueue.length = 0;
    fillQueue.length = 0;

    if (eventsToFlush.length === 0 && fillsToFlush.length === 0) {
      return ok(undefined);
    }

    try {
      // Batch insert order events
      if (eventsToFlush.length > 0) {
        await db.insert(exOrderEvent).values(
          eventsToFlush.map(e => ({
            ts: e.ts,
            exchange: e.exchange,
            symbol: e.symbol,
            clientOrderId: e.clientOrderId,
            exchangeOrderId: e.exchangeOrderId,
            eventType: e.eventType,
            side: e.side,
            px: e.px,
            sz: e.sz,
            postOnly: e.postOnly,
            reason: e.reason,
            state: e.state,
            paramsSetId: e.paramsSetId,
            rawJson: e.rawJson,
          })),
        );
      }

      // Batch insert fills
      if (fillsToFlush.length > 0) {
        await db.insert(exFill).values(
          fillsToFlush.map(f => ({
            ts: f.ts,
            exchange: f.exchange,
            symbol: f.symbol,
            clientOrderId: f.clientOrderId,
            exchangeOrderId: f.exchangeOrderId,
            side: f.side,
            fillPx: f.fillPx,
            fillSz: f.fillSz,
            fee: f.fee,
            liquidity: f.liquidity,
            state: f.state,
            paramsSetId: f.paramsSetId,
            rawJson: f.rawJson,
          })),
        );
      }

      logger.debug("Flushed events", {
        orderEvents: eventsToFlush.length,
        fills: fillsToFlush.length,
      });

      return ok(undefined);
    } catch (error) {
      // Re-queue failed events
      orderEventQueue.push(...eventsToFlush);
      fillQueue.push(...fillsToFlush);

      return err({
        type: "db_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return {
    queueOrderEvent(event: OrderEventRecord): void {
      orderEventQueue.push(event);
    },

    queueFill(fill: FillRecord): void {
      fillQueue.push(fill);
    },

    async flush(): Promise<Result<void, EventRepositoryError>> {
      return doFlush();
    },

    startPeriodicFlush(intervalMs: number): void {
      if (flushIntervalId) return;

      flushIntervalId = setInterval(() => {
        doFlush().catch(error => {
          logger.error("Periodic flush failed", error);
        });
      }, intervalMs);
    },

    async stop(): Promise<Result<void, EventRepositoryError>> {
      if (flushIntervalId) {
        clearInterval(flushIntervalId);
        flushIntervalId = null;
      }
      return doFlush();
    },
  };
}
