/**
 * Event Stream - Load market data from DB for backtest replay
 *
 * Requirements: 11.1
 * - Load md_bbo, md_trade, md_price in ts ascending order
 * - Provide unified event stream for tick processing
 */

import type { MdBbo, MdPrice, MdTrade } from "@agentic-mm-bot/db";
import type { MarketDataRepository, MarketDataArrays } from "@agentic-mm-bot/repositories";

/**
 * Unified market event type
 */
export type MarketEvent =
  | { type: "bbo"; ts: Date; data: MdBbo }
  | { type: "trade"; ts: Date; data: MdTrade }
  | { type: "price"; ts: Date; data: MdPrice };

/**
 * Load parameters
 */
export interface LoadParams {
  exchange: string;
  symbol: string;
  startTime: Date;
  endTime: Date;
}

/**
 * Load all market data for the specified period
 *
 * Note: For MVP simplicity, we load all data at once.
 * For long periods, consider cursor-based pagination.
 */
export async function loadMarketData(repo: MarketDataRepository, params: LoadParams): Promise<MarketDataArrays> {
  const { exchange, symbol, startTime, endTime } = params;

  const result = await repo.loadMarketData(exchange, symbol, startTime, endTime);

  if (result.isErr()) {
    throw new Error(`Failed to load market data: ${result.error.message}`);
  }

  return result.value;
}

/**
 * Merge market data into a single sorted event stream
 */
export function mergeToEventStream(data: MarketDataArrays): MarketEvent[] {
  const events: MarketEvent[] = [];

  for (const bbo of data.bboData) {
    events.push({ type: "bbo", ts: bbo.ts, data: bbo });
  }

  for (const trade of data.tradeData) {
    events.push({ type: "trade", ts: trade.ts, data: trade });
  }

  for (const price of data.priceData) {
    events.push({ type: "price", ts: price.ts, data: price });
  }

  // Sort by timestamp ascending
  events.sort((a, b) => a.ts.getTime() - b.ts.getTime());

  return events;
}

/**
 * Get the time range from event stream
 */
export function getEventStreamTimeRange(events: MarketEvent[]): { startMs: number; endMs: number } | null {
  if (events.length === 0) {
    return null;
  }

  return {
    startMs: events[0].ts.getTime(),
    endMs: events[events.length - 1].ts.getTime(),
  };
}

// Re-export for backwards compatibility
export type { MarketDataArrays };
