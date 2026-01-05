/**
 * Market Data Port - Interface for market data subscriptions
 *
 * Requirements: 2.3, 3.1
 * - Adapters implement this port for venue-specific market data
 */

import type { Result } from "neverthrow";

/**
 * BBO (Best Bid/Offer) event
 */
export interface BboEvent {
  type: "bbo";
  ts: Date;
  exchange: string;
  symbol: string;
  bestBidPx: string;
  bestBidSz: string;
  bestAskPx: string;
  bestAskSz: string;
  seq?: number;
  raw?: unknown;
}

/**
 * Trade event
 */
export interface TradeEvent {
  type: "trade";
  ts: Date;
  exchange: string;
  symbol: string;
  tradeId?: string;
  side?: "buy" | "sell";
  px: string;
  sz: string;
  tradeType?: "normal" | "liq" | "delev";
  seq?: number;
  raw?: unknown;
}

/**
 * Price event (mark/index)
 */
export interface PriceEvent {
  type: "price";
  priceType: "mark" | "index";
  ts: Date;
  exchange: string;
  symbol: string;
  markPx?: string;
  indexPx?: string;
  seq?: number;
  raw?: unknown;
}

/**
 * Funding rate event
 *
 * Note: MVP does not persist funding rates to DB,
 * but the event is converted and logged for observability.
 */
export interface FundingRateEvent {
  type: "funding";
  ts: Date;
  exchange: string;
  symbol: string;
  fundingRate: string;
  seq?: number;
  raw?: unknown;
}

/**
 * Connection event
 */
export interface ConnectionEvent {
  type: "connected" | "disconnected" | "reconnecting";
  ts: Date;
  exchange: string;
  reason?: string;
}

export type MarketDataEvent =
  | BboEvent
  | TradeEvent
  | PriceEvent
  | FundingRateEvent
  | ConnectionEvent;

/**
 * Market data subscription options
 */
export interface MarketDataSubscription {
  exchange: string;
  symbol: string;
  channels: ("bbo" | "trades" | "prices" | "funding")[];
}

/**
 * Market data adapter errors
 */
export type MarketDataError =
  | { type: "connection_failed"; message: string }
  | { type: "subscription_failed"; message: string }
  | { type: "invalid_message"; message: string };

/**
 * Market Data Port interface
 *
 * Requirements: 2.3
 * - Venue-agnostic interface for market data subscriptions
 */
export interface MarketDataPort {
  /**
   * Subscribe to market data
   */
  subscribe(
    subscription: MarketDataSubscription,
  ): Result<void, MarketDataError>;

  /**
   * Unsubscribe from market data
   */
  unsubscribe(
    subscription: MarketDataSubscription,
  ): Result<void, MarketDataError>;

  /**
   * Connect to market data stream
   */
  connect(): Promise<Result<void, MarketDataError>>;

  /**
   * Disconnect from market data stream
   */
  disconnect(): Promise<Result<void, MarketDataError>>;

  /**
   * Register event handler
   */
  onEvent(handler: (event: MarketDataEvent) => void): void;

  /**
   * Check if connected
   */
  isConnected(): boolean;
}
