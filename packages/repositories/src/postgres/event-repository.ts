/**
 * Postgres Event Repository
 *
 * Requirements: 4.4, 4.10
 * - Non-blocking async batch writes for events
 * - Queues events in memory and flushes periodically
 */

import { ok, err } from "neverthrow";
import type { Result } from "neverthrow";
import { exOrderEvent, exFill } from "@agentic-mm-bot/db";
import type { Db } from "@agentic-mm-bot/db";
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
export function createPostgresEventRepository(db: Db): EventRepository {
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
      // #region agent log (debug)
      void fetch("http://127.0.0.1:7247/ingest/3d58f168-0a7e-4968-9928-76ef44de0352", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "debug-session",
          runId: "pre-fix",
          hypothesisId: "H2",
          location: "packages/repositories/src/postgres/event-repository.ts:doFlush",
          message: "doFlush begin",
          data: {
            eventsToFlush: eventsToFlush.length,
            fillsToFlush: fillsToFlush.length,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion

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

      // #region agent log (debug)
      void fetch("http://127.0.0.1:7247/ingest/3d58f168-0a7e-4968-9928-76ef44de0352", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "debug-session",
          runId: "pre-fix",
          hypothesisId: "H2",
          location: "packages/repositories/src/postgres/event-repository.ts:doFlush",
          message: "doFlush DB_ERROR",
          data: {
            message: error instanceof Error ? error.message : String(error),
            requeuedEvents: eventsToFlush.length,
            requeuedFills: fillsToFlush.length,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion

      return err({
        type: "DB_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return {
    queueOrderEvent(event: OrderEventRecord): void {
      orderEventQueue.push(event);
      // #region agent log (debug)
      void fetch("http://127.0.0.1:7247/ingest/3d58f168-0a7e-4968-9928-76ef44de0352", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "debug-session",
          runId: "pre-fix",
          hypothesisId: "H2",
          location: "packages/repositories/src/postgres/event-repository.ts:queueOrderEvent",
          message: "queued order event",
          data: {
            orderEventQueue: orderEventQueue.length,
            eventType: event.eventType,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
    },

    queueFill(fill: FillRecord): void {
      fillQueue.push(fill);
      // #region agent log (debug)
      void fetch("http://127.0.0.1:7247/ingest/3d58f168-0a7e-4968-9928-76ef44de0352", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "debug-session",
          runId: "pre-fix",
          hypothesisId: "H2",
          location: "packages/repositories/src/postgres/event-repository.ts:queueFill",
          message: "queued fill",
          data: {
            fillQueue: fillQueue.length,
            symbol: fill.symbol,
            side: fill.side,
            fillPx: fill.fillPx,
            fillSz: fill.fillSz,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
    },

    async flush(): Promise<Result<void, EventRepositoryError>> {
      return doFlush();
    },

    startPeriodicFlush(intervalMs: number): void {
      if (flushIntervalId) return;

      flushIntervalId = setInterval(() => {
        void doFlush()
          .then(result => {
            // NOTE: doFlush() returns Result (it does not throw on DB errors).
            // If we ignore Err here, DB write failures become "silent" and fills/events
            // will never reach the database while the in-memory queue keeps growing.
            if (result.isErr()) {
              logger.error("Periodic flush failed", result.error);
            }
          })
          .catch((error: unknown) => {
            // Defensive: unexpected error outside doFlush's try/catch.
            logger.error("Periodic flush crashed", error);
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
