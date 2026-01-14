/**
 * Order Tracker - In-memory tracking of active orders
 *
 * Requirements: 4.6, 4.7, 7.7
 * - Track active orders for execution planning
 * - Update from fills and order events
 */

import type { Ms, PriceStr, Side, SizeStr } from "@agentic-mm-bot/core";
import type { FillEvent, OpenOrder, OrderUpdateEvent } from "@agentic-mm-bot/adapters";

/**
 * Tracked order
 */
export interface TrackedOrder {
  clientOrderId: string;
  exchangeOrderId?: string;
  side: Side;
  price: PriceStr;
  size: SizeStr;
  filledSize: SizeStr;
  createdAtMs: Ms;
}

/**
 * Order Tracker
 *
 * Tracks active orders in memory for execution planning.
 */
export class OrderTracker {
  private orders: Map<string, TrackedOrder> = new Map();

  /**
   * Add a new order
   */
  addOrder(order: {
    clientOrderId: string;
    exchangeOrderId?: string;
    side: Side;
    price: PriceStr;
    size: SizeStr;
    createdAtMs: Ms;
  }): void {
    this.orders.set(order.clientOrderId, {
      ...order,
      filledSize: "0",
    });
  }

  /**
   * Update from fill event
   */
  updateFromFill(event: FillEvent): void {
    const order = this.orders.get(event.clientOrderId);
    if (!order) return;

    const currentFilled = parseFloat(order.filledSize);
    const newFill = parseFloat(event.size);
    order.filledSize = (currentFilled + newFill).toString();

    // Remove if fully filled
    const totalSize = parseFloat(order.size);
    if (currentFilled + newFill >= totalSize) {
      this.orders.delete(event.clientOrderId);
    }
  }

  /**
   * Update from order update event
   */
  updateFromOrderEvent(event: OrderUpdateEvent): void {
    if (event.status === "cancelled" || event.status === "rejected" || event.status === "filled") {
      this.orders.delete(event.clientOrderId);
    }
  }

  /**
   * Sync from REST API response
   *
   * Note: If clientOrderId is empty/undefined, we use exchangeOrderId as the Map key
   * to prevent multiple orders from collapsing to the same key.
   */
  syncFromOpenOrders(openOrders: OpenOrder[]): void {
    // Clear current orders
    this.orders.clear();

    // Add from REST response
    for (const order of openOrders) {
      // Use clientOrderId if available, otherwise fallback to exchangeOrderId-based key
      const key =
        order.clientOrderId && order.clientOrderId.trim() !== "" ?
          order.clientOrderId
        : `__ext_${order.exchangeOrderId}`;

      this.orders.set(key, {
        clientOrderId: key,
        exchangeOrderId: order.exchangeOrderId,
        side: order.side,
        price: order.price,
        size: order.size,
        filledSize: order.filledSize,
        createdAtMs: order.createdAt.getTime(),
      });
    }
  }

  /**
   * Get active orders
   */
  getActiveOrders(): TrackedOrder[] {
    return Array.from(this.orders.values());
  }

  /**
   * Get order by client order ID
   */
  getOrder(clientOrderId: string): TrackedOrder | undefined {
    return this.orders.get(clientOrderId);
  }

  /**
   * Check if we have active orders on a side
   */
  hasOrderOnSide(side: Side): boolean {
    return Array.from(this.orders.values()).some(o => o.side === side);
  }

  /**
   * Get bid order (if any)
   */
  getBidOrder(): TrackedOrder | undefined {
    return Array.from(this.orders.values()).find(o => o.side === "buy");
  }

  /**
   * Get ask order (if any)
   */
  getAskOrder(): TrackedOrder | undefined {
    return Array.from(this.orders.values()).find(o => o.side === "sell");
  }

  /**
   * Clear all orders (for cancel_all)
   */
  clear(): void {
    this.orders.clear();
  }

  /**
   * Remove a single order (best-effort)
   *
   * We call this after a successful cancel request to avoid relying solely on
   * async order update events (which can be delayed or dropped).
   */
  removeOrder(clientOrderId: string): boolean {
    return this.orders.delete(clientOrderId);
  }
}
