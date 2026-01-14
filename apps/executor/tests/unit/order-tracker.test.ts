/**
 * Order Tracker Unit Tests
 *
 * Requirements: 4.6, 4.7, 7.7
 * - syncFromOpenOrders() correctly handles multiple orders
 * - Orders with empty/undefined clientOrderId don't collapse
 * - Fallback keys (__ext_<exchangeOrderId>) work correctly
 */

import { describe, expect, test, beforeEach } from "bun:test";

import { OrderTracker } from "../../src/services/order-tracker";
import type { OpenOrder } from "@agentic-mm-bot/adapters";

// ─────────────────────────────────────────────────────────────────────────────
// Helper factories
// ─────────────────────────────────────────────────────────────────────────────

function createOpenOrder(overrides: Partial<OpenOrder> = {}): OpenOrder {
  return {
    clientOrderId: `ord_${Date.now()}_test`,
    exchangeOrderId: "12345",
    symbol: "BTC-USD",
    side: "buy",
    price: "95000",
    size: "0.1",
    filledSize: "0",
    status: "open",
    createdAt: new Date("2024-01-01T12:00:00Z"),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// syncFromOpenOrders Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("OrderTracker.syncFromOpenOrders", () => {
  let tracker: OrderTracker;

  beforeEach(() => {
    tracker = new OrderTracker();
  });

  test("should sync orders with valid clientOrderIds", () => {
    const orders: OpenOrder[] = [
      createOpenOrder({
        clientOrderId: "ord_1",
        exchangeOrderId: "111",
        side: "buy",
        price: "95000",
      }),
      createOpenOrder({
        clientOrderId: "ord_2",
        exchangeOrderId: "222",
        side: "sell",
        price: "96000",
      }),
    ];

    tracker.syncFromOpenOrders(orders);

    expect(tracker.getActiveOrders().length).toBe(2);
    expect(tracker.getOrder("ord_1")).toBeDefined();
    expect(tracker.getOrder("ord_2")).toBeDefined();
  });

  test("should not collapse orders with empty clientOrderId - use fallback keys", () => {
    // Simulate orders from exchange without externalId (clientOrderId is empty)
    const orders: OpenOrder[] = [
      createOpenOrder({
        clientOrderId: "", // Empty clientOrderId
        exchangeOrderId: "111",
        side: "buy",
        price: "95000",
      }),
      createOpenOrder({
        clientOrderId: "", // Empty clientOrderId
        exchangeOrderId: "222",
        side: "sell",
        price: "96000",
      }),
    ];

    tracker.syncFromOpenOrders(orders);

    // Both orders should be tracked (not collapsed to 1)
    expect(tracker.getActiveOrders().length).toBe(2);

    // Should use fallback keys
    expect(tracker.getOrder("__ext_111")).toBeDefined();
    expect(tracker.getOrder("__ext_222")).toBeDefined();
  });

  test("should handle orders with whitespace-only clientOrderId", () => {
    const orders: OpenOrder[] = [
      createOpenOrder({
        clientOrderId: "   ", // Whitespace-only
        exchangeOrderId: "333",
        side: "buy",
      }),
    ];

    tracker.syncFromOpenOrders(orders);

    expect(tracker.getActiveOrders().length).toBe(1);
    expect(tracker.getOrder("__ext_333")).toBeDefined();
  });

  test("should clear existing orders before syncing", () => {
    // First, add an order manually
    tracker.addOrder({
      clientOrderId: "old_order",
      side: "buy",
      price: "94000",
      size: "0.1",
      createdAtMs: Date.now(),
    });
    expect(tracker.getActiveOrders().length).toBe(1);

    // Now sync with different orders
    tracker.syncFromOpenOrders([
      createOpenOrder({
        clientOrderId: "new_order",
        exchangeOrderId: "999",
      }),
    ]);

    // Old order should be gone, only new order remains
    expect(tracker.getActiveOrders().length).toBe(1);
    expect(tracker.getOrder("old_order")).toBeUndefined();
    expect(tracker.getOrder("new_order")).toBeDefined();
  });

  test("should handle mixed clientOrderIds - some valid, some empty", () => {
    const orders: OpenOrder[] = [
      createOpenOrder({
        clientOrderId: "ord_valid_1",
        exchangeOrderId: "100",
        side: "buy",
      }),
      createOpenOrder({
        clientOrderId: "", // Needs fallback
        exchangeOrderId: "200",
        side: "sell",
      }),
      createOpenOrder({
        clientOrderId: "ord_valid_2",
        exchangeOrderId: "300",
        side: "buy",
      }),
    ];

    tracker.syncFromOpenOrders(orders);

    expect(tracker.getActiveOrders().length).toBe(3);
    expect(tracker.getOrder("ord_valid_1")).toBeDefined();
    expect(tracker.getOrder("__ext_200")).toBeDefined();
    expect(tracker.getOrder("ord_valid_2")).toBeDefined();
  });

  test("should preserve exchangeOrderId in tracked orders", () => {
    const orders: OpenOrder[] = [
      createOpenOrder({
        clientOrderId: "__ext_555", // Fallback key format
        exchangeOrderId: "555",
        side: "buy",
        price: "95500",
        size: "0.2",
      }),
    ];

    tracker.syncFromOpenOrders(orders);

    const tracked = tracker.getOrder("__ext_555");
    expect(tracked).toBeDefined();
    expect(tracked?.exchangeOrderId).toBe("555");
    expect(tracked?.price).toBe("95500");
    expect(tracked?.size).toBe("0.2");
  });

  test("should handle empty orders array", () => {
    // First add some orders
    tracker.addOrder({
      clientOrderId: "existing",
      side: "buy",
      price: "94000",
      size: "0.1",
      createdAtMs: Date.now(),
    });

    // Sync with empty array
    tracker.syncFromOpenOrders([]);

    expect(tracker.getActiveOrders().length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getBidOrder / getAskOrder Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("OrderTracker.getBidOrder / getAskOrder", () => {
  let tracker: OrderTracker;

  beforeEach(() => {
    tracker = new OrderTracker();
  });

  test("should find bid and ask orders after sync", () => {
    tracker.syncFromOpenOrders([
      createOpenOrder({
        clientOrderId: "bid_1",
        exchangeOrderId: "100",
        side: "buy",
        price: "95000",
      }),
      createOpenOrder({
        clientOrderId: "ask_1",
        exchangeOrderId: "200",
        side: "sell",
        price: "96000",
      }),
    ]);

    const bid = tracker.getBidOrder();
    const ask = tracker.getAskOrder();

    expect(bid?.clientOrderId).toBe("bid_1");
    expect(bid?.side).toBe("buy");
    expect(ask?.clientOrderId).toBe("ask_1");
    expect(ask?.side).toBe("sell");
  });

  test("should find orders with fallback keys", () => {
    tracker.syncFromOpenOrders([
      createOpenOrder({
        clientOrderId: "", // Will become __ext_100
        exchangeOrderId: "100",
        side: "buy",
      }),
      createOpenOrder({
        clientOrderId: "", // Will become __ext_200
        exchangeOrderId: "200",
        side: "sell",
      }),
    ]);

    const bid = tracker.getBidOrder();
    const ask = tracker.getAskOrder();

    expect(bid?.clientOrderId).toBe("__ext_100");
    expect(bid?.side).toBe("buy");
    expect(ask?.clientOrderId).toBe("__ext_200");
    expect(ask?.side).toBe("sell");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// removeOrder Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("OrderTracker.removeOrder", () => {
  let tracker: OrderTracker;

  beforeEach(() => {
    tracker = new OrderTracker();
    tracker.syncFromOpenOrders([
      createOpenOrder({
        clientOrderId: "__ext_100",
        exchangeOrderId: "100",
        side: "buy",
      }),
      createOpenOrder({
        clientOrderId: "ord_regular",
        exchangeOrderId: "200",
        side: "sell",
      }),
    ]);
  });

  test("should remove order by fallback key", () => {
    expect(tracker.getActiveOrders().length).toBe(2);

    const removed = tracker.removeOrder("__ext_100");

    expect(removed).toBe(true);
    expect(tracker.getActiveOrders().length).toBe(1);
    expect(tracker.getOrder("__ext_100")).toBeUndefined();
  });

  test("should remove order by regular clientOrderId", () => {
    const removed = tracker.removeOrder("ord_regular");

    expect(removed).toBe(true);
    expect(tracker.getOrder("ord_regular")).toBeUndefined();
  });

  test("should return false for non-existent order", () => {
    const removed = tracker.removeOrder("non_existent");

    expect(removed).toBe(false);
  });
});
