/**
 * Event Repository Interface
 *
 * Requirements: 4.4, 4.10
 * - Persist order events, fills, and market data
 * - Non-blocking async batch writes
 */

import type { Result } from "neverthrow";

/**
 * Order event for persistence
 */
export interface OrderEventRecord {
  ts: Date;
  exchange: string;
  symbol: string;
  clientOrderId: string;
  exchangeOrderId: string | null;
  eventType: "place" | "cancel" | "ack" | "reject" | "fill";
  side: "buy" | "sell" | null;
  px: string | null;
  sz: string | null;
  postOnly: boolean;
  reason: string | null;
  state: string | null;
  paramsSetId: string | null;
  rawJson: unknown;
}

/**
 * Fill record for persistence
 */
export interface FillRecord {
  ts: Date;
  exchange: string;
  symbol: string;
  clientOrderId: string;
  exchangeOrderId: string | null;
  side: "buy" | "sell";
  fillPx: string;
  fillSz: string;
  fee: string | null;
  liquidity: "maker" | "taker" | null;
  state: string;
  paramsSetId: string;
  rawJson: unknown;
}

/**
 * Repository error types
 */
export type EventRepositoryError = { type: "DB_ERROR"; message: string };

/**
 * Event Repository Interface
 *
 * Provides async batch writes for events to avoid blocking hot path.
 */
export interface EventRepository {
  /**
   * Queue an order event for batch write
   */
  queueOrderEvent(event: OrderEventRecord): void;

  /**
   * Queue a fill for batch write
   */
  queueFill(fill: FillRecord): void;

  /**
   * Flush all queued events to the database
   */
  flush(): Promise<Result<void, EventRepositoryError>>;

  /**
   * Start periodic flush
   */
  startPeriodicFlush(intervalMs: number): void;

  /**
   * Stop periodic flush and flush remaining events
   */
  stop(): Promise<Result<void, EventRepositoryError>>;
}
