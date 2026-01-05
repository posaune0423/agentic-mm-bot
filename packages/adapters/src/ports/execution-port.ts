/**
 * Execution Port - Interface for order execution
 *
 * Requirements: 2.3, 4.3
 * - Adapters implement this port for venue-specific trading
 */

import type { ResultAsync } from "neverthrow";

/**
 * Order side
 */
export type OrderSide = "buy" | "sell";

/**
 * Order status
 */
export type OrderStatus = "pending" | "open" | "filled" | "cancelled" | "rejected";

/**
 * Place order request
 */
export interface PlaceOrderRequest {
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  price: string;
  size: string;
  postOnly: boolean;
}

/**
 * Order response
 */
export interface OrderResponse {
  clientOrderId: string;
  exchangeOrderId?: string;
  status: OrderStatus;
  filledSize?: string;
  avgPrice?: string;
  reason?: string;
  ts: Date;
}

/**
 * Cancel order request
 */
export interface CancelOrderRequest {
  clientOrderId?: string;
  exchangeOrderId?: string;
  symbol: string;
}

/**
 * Open order
 */
export interface OpenOrder {
  clientOrderId: string;
  exchangeOrderId: string;
  symbol: string;
  side: OrderSide;
  price: string;
  size: string;
  filledSize: string;
  status: OrderStatus;
  createdAt: Date;
}

/**
 * Position
 */
export interface PositionInfo {
  symbol: string;
  size: string;
  entryPrice?: string;
  unrealizedPnl?: string;
  updatedAt: Date;
}

/**
 * Fill event
 */
export interface FillEvent {
  type: "fill";
  ts: Date;
  clientOrderId: string;
  exchangeOrderId?: string;
  symbol: string;
  side: OrderSide;
  price: string;
  size: string;
  fee?: string;
  liquidity?: "maker" | "taker";
}

/**
 * Order update event
 */
export interface OrderUpdateEvent {
  type: "order_update";
  ts: Date;
  clientOrderId: string;
  exchangeOrderId?: string;
  status: OrderStatus;
  reason?: string;
}

export type ExecutionEvent = FillEvent | OrderUpdateEvent;

/**
 * Execution adapter errors
 */
export type ExecutionError =
  | { type: "network"; message: string }
  | { type: "rate_limit"; message: string; retryAfterMs?: number }
  | { type: "auth"; message: string }
  | { type: "invalid_order"; message: string }
  | { type: "insufficient_balance"; message: string }
  | { type: "post_only_rejected"; message: string }
  | { type: "exchange_error"; message: string; code?: string }
  | { type: "unknown"; message: string };

/**
 * Execution Port interface
 *
 * Requirements: 2.3, 4.3
 * - Venue-agnostic interface for order execution
 */
export interface ExecutionPort {
  /**
   * Place a new order
   */
  placeOrder(request: PlaceOrderRequest): ResultAsync<OrderResponse, ExecutionError>;

  /**
   * Cancel an order
   */
  cancelOrder(request: CancelOrderRequest): ResultAsync<OrderResponse, ExecutionError>;

  /**
   * Cancel all orders for a symbol
   */
  cancelAllOrders(symbol: string): ResultAsync<void, ExecutionError>;

  /**
   * Get open orders
   */
  getOpenOrders(symbol: string): ResultAsync<OpenOrder[], ExecutionError>;

  /**
   * Get current position
   */
  getPosition(symbol: string): ResultAsync<PositionInfo | null, ExecutionError>;

  /**
   * Register event handler for fills and order updates
   */
  onEvent(handler: (event: ExecutionEvent) => void): void;

  /**
   * Connect to private stream (if available)
   */
  connectPrivateStream(): ResultAsync<void, ExecutionError>;

  /**
   * Disconnect from private stream
   */
  disconnectPrivateStream(): ResultAsync<void, ExecutionError>;
}
