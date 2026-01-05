/**
 * Ingestor Types
 *
 * Shared type definitions for the ingestor application
 */

/**
 * Latest market data state for periodic upsert to latest_top
 *
 * Requirements: 3.3
 * - Collects latest BBO and prices in memory
 * - Upserts to latest_top on a fixed interval (not every event)
 */
export interface LatestState {
  exchange: string;
  symbol: string;
  ts: Date;
  bestBidPx: string;
  bestBidSz: string;
  bestAskPx: string;
  bestAskSz: string;
  midPx: string;
  markPx?: string;
  indexPx?: string;
  dirty: boolean; // true if state has changed since last upsert
}

/**
 * Ingestor metrics for observability
 */
export interface IngestorMetrics {
  bboReceived: number;
  bboWritten: number;
  tradeReceived: number;
  priceReceived: number;
  fundingReceived: number;
  bboBufferSize: number;
  tradeBufferSize: number;
  priceBufferSize: number;
}
