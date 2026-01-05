/**
 * Market Data Repository Interface
 *
 * Requirements: 3.2, 9.2, 11.1
 * - Batch insert market data (BBO, Trade, Price)
 * - Lookup reference prices for markout calculation
 * - Load historical data for backtest
 * - Upsert latest_top state
 */

import type { Result, ResultAsync } from "neverthrow";
import type { MdBbo, MdTrade, MdPrice } from "@agentic-mm-bot/db";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type MarketDataRepositoryError = { type: "DB_ERROR"; message: string } | { type: "NOT_FOUND"; message: string };

/**
 * BBO insert record
 */
export interface BboInsert {
  ts: Date;
  exchange: string;
  symbol: string;
  bestBidPx: string;
  bestBidSz: string;
  bestAskPx: string;
  bestAskSz: string;
  midPx: string;
  seq?: number | null;
  rawJson?: unknown;
}

/**
 * Trade insert record
 */
export interface TradeInsert {
  ts: Date;
  exchange: string;
  symbol: string;
  tradeId: string;
  side: string | null;
  px: string;
  sz: string;
  type?: string | null;
  seq?: number | null;
  rawJson?: unknown;
}

/**
 * Price insert record
 */
export interface PriceInsert {
  ts: Date;
  exchange: string;
  symbol: string;
  markPx?: string | null;
  indexPx?: string | null;
  rawJson?: unknown;
}

/**
 * Latest top state for upsert
 */
export interface LatestTopState {
  exchange: string;
  symbol: string;
  ts: Date;
  bestBidPx: string;
  bestBidSz: string;
  bestAskPx: string;
  bestAskSz: string;
  midPx: string;
  markPx?: string | null;
  indexPx?: string | null;
}

/**
 * BBO reference data (for markout calculation)
 */
export interface BboRef {
  midPx: string;
  spreadBps: string;
  bestBidPx: string;
  bestAskPx: string;
  ts: Date;
}

/**
 * Price reference data (mark/index)
 */
export interface PriceRef {
  markPx: string | null;
  indexPx: string | null;
  ts: Date;
}

/**
 * Market data load result (for backtest)
 */
export interface MarketDataArrays {
  bboData: MdBbo[];
  tradeData: MdTrade[];
  priceData: MdPrice[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Interface
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketDataRepository {
  // ─────────────────────────────────────────────────────────────────────────────
  // Batch Insert (Ingestor)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Batch insert BBO records
   */
  insertBboBatch(records: BboInsert[]): ResultAsync<void, MarketDataRepositoryError>;

  /**
   * Batch insert Trade records
   */
  insertTradeBatch(records: TradeInsert[]): ResultAsync<void, MarketDataRepositoryError>;

  /**
   * Batch insert Price records
   */
  insertPriceBatch(records: PriceInsert[]): ResultAsync<void, MarketDataRepositoryError>;

  /**
   * Upsert latest_top state
   */
  upsertLatestTop(state: LatestTopState): ResultAsync<void, MarketDataRepositoryError>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Lookup (Summarizer - markout calculation)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Find closest BBO to a timestamp within tolerance
   */
  findClosestBbo(
    exchange: string,
    symbol: string,
    targetTs: Date,
    toleranceMs: number,
  ): Promise<Result<BboRef | null, MarketDataRepositoryError>>;

  /**
   * Find closest Price to a timestamp within tolerance
   */
  findClosestPrice(
    exchange: string,
    symbol: string,
    targetTs: Date,
    toleranceMs: number,
  ): Promise<Result<PriceRef | null, MarketDataRepositoryError>>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Window Queries (Summarizer - feature calculation)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get trades in a time window (for trade imbalance, liq count)
   */
  getTradesInWindow(
    exchange: string,
    symbol: string,
    windowStart: Date,
    windowEnd: Date,
  ): ResultAsync<MdTrade[], MarketDataRepositoryError>;

  /**
   * Get BBOs in a time window (for realized vol)
   */
  getBbosInWindow(
    exchange: string,
    symbol: string,
    windowStart: Date,
    windowEnd: Date,
    limit?: number,
  ): ResultAsync<MdBbo[], MarketDataRepositoryError>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Bulk Load (Backtest)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Load all market data for a time period (for backtest replay)
   */
  loadMarketData(
    exchange: string,
    symbol: string,
    startTime: Date,
    endTime: Date,
  ): ResultAsync<MarketDataArrays, MarketDataRepositoryError>;
}
