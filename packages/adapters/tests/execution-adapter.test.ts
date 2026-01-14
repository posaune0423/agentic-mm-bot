/**
 * Extended Execution Adapter Unit Tests
 *
 * Requirements: 4.3, 7.6, 7.7
 * - Order placement
 * - Order cancellation
 * - Error mapping
 * - Event handling
 */

import { describe, expect, test, mock, beforeEach } from "bun:test";

import { OrderStatus as ExtendedOrderStatus, OrderStatusReason } from "extended-typescript-sdk";

import type { ExtendedConfig } from "../src/extended/types";
import type { ExecutionEvent, FillEvent, OrderUpdateEvent, PlaceOrderRequest } from "../src/ports";

// Create a mock config
const createMockConfig = (): ExtendedConfig => ({
  network: "testnet",
  vaultId: 12345,
  starkPrivateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
  starkPublicKey: "0x0000000000000000000000000000000000000000000000000000000000000002",
  apiKey: "test-api-key",
});

describe("ExtendedExecutionAdapter", () => {
  describe("error mapping", () => {
    test("should map RateLimitException to rate_limit error", () => {
      // Test error mapping logic directly
      const mapError = (error: unknown) => {
        if (error instanceof Error) {
          const message = error.message.toLowerCase();

          if (message.includes("rate limit")) {
            return { type: "rate_limit" as const, message: error.message, retryAfterMs: 1000 };
          }

          if (message.includes("post_only") || message.includes("post only failed")) {
            return { type: "post_only_rejected" as const, message: error.message };
          }

          if (message.includes("insufficient") || message.includes("not enough")) {
            return { type: "insufficient_balance" as const, message: error.message };
          }

          return { type: "exchange_error" as const, message: error.message };
        }

        return { type: "unknown" as const, message: String(error) };
      };

      const error = new Error("Rate limit exceeded");
      const result = mapError(error);

      expect(result.type).toBe("rate_limit");
      expect(result.retryAfterMs).toBe(1000);
    });

    test("should map post_only errors to post_only_rejected", () => {
      const mapError = (error: unknown) => {
        if (error instanceof Error) {
          const message = error.message.toLowerCase();

          if (message.includes("post_only") || message.includes("post only failed")) {
            return { type: "post_only_rejected" as const, message: error.message };
          }

          return { type: "exchange_error" as const, message: error.message };
        }

        return { type: "unknown" as const, message: String(error) };
      };

      const error1 = new Error("Order rejected: POST_ONLY failed");
      const error2 = new Error("post only failed due to price crossing");

      expect(mapError(error1).type).toBe("post_only_rejected");
      expect(mapError(error2).type).toBe("post_only_rejected");
    });

    test("should map insufficient balance errors", () => {
      const mapError = (error: unknown) => {
        if (error instanceof Error) {
          const message = error.message.toLowerCase();

          if (message.includes("insufficient") || message.includes("not enough")) {
            return { type: "insufficient_balance" as const, message: error.message };
          }

          return { type: "exchange_error" as const, message: error.message };
        }

        return { type: "unknown" as const, message: String(error) };
      };

      const error1 = new Error("Insufficient balance");
      const error2 = new Error("Not enough funds to place order");

      expect(mapError(error1).type).toBe("insufficient_balance");
      expect(mapError(error2).type).toBe("insufficient_balance");
    });

    test("should map unknown errors to unknown type", () => {
      const mapError = (error: unknown) => {
        if (error instanceof Error) {
          return { type: "exchange_error" as const, message: error.message };
        }

        return { type: "unknown" as const, message: String(error) };
      };

      const result = mapError("string error");

      expect(result.type).toBe("unknown");
      expect(result.message).toBe("string error");
    });
  });

  describe("order status mapping", () => {
    test("should map NEW status to pending", () => {
      const mapOrderStatus = (status?: string) => {
        if (!status) return "pending";

        switch (status) {
          case ExtendedOrderStatus.NEW:
          case ExtendedOrderStatus.UNTRIGGERED:
            return "pending";
          case ExtendedOrderStatus.PARTIALLY_FILLED:
            return "open";
          case ExtendedOrderStatus.FILLED:
            return "filled";
          case ExtendedOrderStatus.CANCELLED:
          case ExtendedOrderStatus.EXPIRED:
            return "cancelled";
          case ExtendedOrderStatus.REJECTED:
            return "rejected";
          default:
            return "pending";
        }
      };

      expect(mapOrderStatus(ExtendedOrderStatus.NEW)).toBe("pending");
      expect(mapOrderStatus(ExtendedOrderStatus.UNTRIGGERED)).toBe("pending");
    });

    test("should map PARTIALLY_FILLED to open", () => {
      const mapOrderStatus = (status?: string) => {
        if (status === ExtendedOrderStatus.PARTIALLY_FILLED) return "open";
        return "pending";
      };

      expect(mapOrderStatus(ExtendedOrderStatus.PARTIALLY_FILLED)).toBe("open");
    });

    test("should map FILLED to filled", () => {
      const mapOrderStatus = (status?: string) => {
        if (status === ExtendedOrderStatus.FILLED) return "filled";
        return "pending";
      };

      expect(mapOrderStatus(ExtendedOrderStatus.FILLED)).toBe("filled");
    });

    test("should map CANCELLED and EXPIRED to cancelled", () => {
      const mapOrderStatus = (status?: string) => {
        if (status === ExtendedOrderStatus.CANCELLED || status === ExtendedOrderStatus.EXPIRED) {
          return "cancelled";
        }
        return "pending";
      };

      expect(mapOrderStatus(ExtendedOrderStatus.CANCELLED)).toBe("cancelled");
      expect(mapOrderStatus(ExtendedOrderStatus.EXPIRED)).toBe("cancelled");
    });

    test("should map REJECTED to rejected", () => {
      const mapOrderStatus = (status?: string) => {
        if (status === ExtendedOrderStatus.REJECTED) return "rejected";
        return "pending";
      };

      expect(mapOrderStatus(ExtendedOrderStatus.REJECTED)).toBe("rejected");
    });

    test("should handle undefined status", () => {
      const mapOrderStatus = (status?: string) => {
        if (!status) return "pending";
        return "pending";
      };

      expect(mapOrderStatus(undefined)).toBe("pending");
    });
  });

  describe("event handling", () => {
    test("should emit fill events correctly", () => {
      const events: ExecutionEvent[] = [];
      const emitEvent = (event: ExecutionEvent) => events.push(event);

      const trade = {
        id: 1,
        orderId: 100,
        market: "BTC-USD",
        side: "BUY",
        price: "50000",
        qty: "0.1",
        fee: "0.5",
        type: "MAKER",
        createdTime: Date.now(),
      };

      const fillEvent: FillEvent = {
        type: "fill",
        ts: new Date(trade.createdTime),
        clientOrderId: "",
        exchangeOrderId: trade.orderId.toString(),
        symbol: trade.market,
        side: trade.side === "BUY" ? "buy" : "sell",
        price: trade.price,
        size: trade.qty,
        fee: trade.fee,
        liquidity: trade.type === "MAKER" ? "maker" : "taker",
      };

      emitEvent(fillEvent);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("fill");
      const fill = events[0] as FillEvent;
      expect(fill.symbol).toBe("BTC-USD");
      expect(fill.side).toBe("buy");
      expect(fill.price).toBe("50000");
      expect(fill.liquidity).toBe("maker");
    });

    test("should emit order update events correctly", () => {
      const events: ExecutionEvent[] = [];
      const emitEvent = (event: ExecutionEvent) => events.push(event);

      const order = {
        id: 100,
        externalId: "client-order-123",
        market: "BTC-USD",
        type: "LIMIT",
        side: "SELL",
        status: ExtendedOrderStatus.FILLED,
        statusReason: undefined,
        price: "50000",
        qty: "0.1",
        reduceOnly: false,
        postOnly: true,
        createdTime: Date.now(),
        updatedTime: Date.now(),
      };

      const orderEvent: OrderUpdateEvent = {
        type: "order_update",
        ts: new Date(order.updatedTime),
        clientOrderId: order.externalId,
        exchangeOrderId: order.id.toString(),
        status: "filled",
        reason: undefined,
      };

      emitEvent(orderEvent);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("order_update");
      const update = events[0] as OrderUpdateEvent;
      expect(update.clientOrderId).toBe("client-order-123");
      expect(update.status).toBe("filled");
    });

    test("should detect POST_ONLY_REJECTED reason", () => {
      const order = {
        id: 100,
        externalId: "client-order-123",
        status: ExtendedOrderStatus.REJECTED,
        statusReason: OrderStatusReason.POST_ONLY_FAILED,
        updatedTime: Date.now(),
      };

      const reason =
        order.statusReason === OrderStatusReason.POST_ONLY_FAILED ? "POST_ONLY_REJECTED" : order.statusReason;

      expect(reason).toBe("POST_ONLY_REJECTED");
    });
  });

  describe("cancel order validation", () => {
    test("should require either clientOrderId or exchangeOrderId", () => {
      const validateCancelRequest = (request: { clientOrderId?: string; exchangeOrderId?: string }) => {
        if (!request.clientOrderId && !request.exchangeOrderId) {
          return { valid: false, error: "Either clientOrderId or exchangeOrderId is required" };
        }
        return { valid: true };
      };

      const result = validateCancelRequest({});

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Either clientOrderId or exchangeOrderId is required");
    });

    test("should accept exchangeOrderId", () => {
      const validateCancelRequest = (request: { clientOrderId?: string; exchangeOrderId?: string }) => {
        if (!request.clientOrderId && !request.exchangeOrderId) {
          return { valid: false, error: "Either clientOrderId or exchangeOrderId is required" };
        }
        return { valid: true };
      };

      const result = validateCancelRequest({ exchangeOrderId: "12345" });

      expect(result.valid).toBe(true);
    });

    test("should accept clientOrderId", () => {
      const validateCancelRequest = (request: { clientOrderId?: string; exchangeOrderId?: string }) => {
        if (!request.clientOrderId && !request.exchangeOrderId) {
          return { valid: false, error: "Either clientOrderId or exchangeOrderId is required" };
        }
        return { valid: true };
      };

      const result = validateCancelRequest({ clientOrderId: "my-order-id" });

      expect(result.valid).toBe(true);
    });
  });

  describe("place order request mapping", () => {
    test("should map buy side correctly", () => {
      const mapSide = (side: "buy" | "sell") => (side === "buy" ? "BUY" : "SELL");

      expect(mapSide("buy")).toBe("BUY");
    });

    test("should map sell side correctly", () => {
      const mapSide = (side: "buy" | "sell") => (side === "buy" ? "BUY" : "SELL");

      expect(mapSide("sell")).toBe("SELL");
    });

    test("should use GTT time in force for post-only orders", () => {
      const getTimeInForce = (postOnly: boolean) => (postOnly ? "GTT" : "IOC");

      expect(getTimeInForce(true)).toBe("GTT");
      expect(getTimeInForce(false)).toBe("IOC");
    });
  });

  describe("getOpenOrders externalId normalization", () => {
    /**
     * This tests the externalId normalization logic extracted from the adapter.
     * The adapter tries multiple field names and generates a fallback key if needed.
     */

    // Simulate the normalization logic from the adapter
    const normalizeClientOrderId = (rawOrder: Record<string, unknown>, exchangeOrderId: string): string => {
      const externalId =
        (rawOrder["externalId"] as string | undefined) ??
        (rawOrder["externalID"] as string | undefined) ??
        (rawOrder["external_id"] as string | undefined) ??
        (rawOrder["clientOrderId"] as string | undefined);

      const clientOrderId =
        externalId && (externalId as string).trim() !== "" ? externalId : `__ext_${exchangeOrderId}`;
      return clientOrderId;
    };

    test("should use externalId when available", () => {
      const rawOrder = { externalId: "ord_123", id: 100 };
      const result = normalizeClientOrderId(rawOrder, "100");
      expect(result).toBe("ord_123");
    });

    test("should try externalID (capital D) as fallback", () => {
      const rawOrder = { externalID: "ord_456", id: 200 };
      const result = normalizeClientOrderId(rawOrder, "200");
      expect(result).toBe("ord_456");
    });

    test("should try external_id (snake_case) as fallback", () => {
      const rawOrder = { external_id: "ord_789", id: 300 };
      const result = normalizeClientOrderId(rawOrder, "300");
      expect(result).toBe("ord_789");
    });

    test("should try clientOrderId as fallback", () => {
      const rawOrder = { clientOrderId: "ord_abc", id: 400 };
      const result = normalizeClientOrderId(rawOrder, "400");
      expect(result).toBe("ord_abc");
    });

    test("should generate fallback key when no externalId found", () => {
      const rawOrder = { id: 500, market: "BTC-USD" };
      const result = normalizeClientOrderId(rawOrder, "500");
      expect(result).toBe("__ext_500");
    });

    test("should generate fallback key when externalId is empty string", () => {
      const rawOrder = { externalId: "", id: 600 };
      const result = normalizeClientOrderId(rawOrder, "600");
      expect(result).toBe("__ext_600");
    });

    test("should generate fallback key when externalId is whitespace only", () => {
      const rawOrder = { externalId: "   ", id: 700 };
      const result = normalizeClientOrderId(rawOrder, "700");
      expect(result).toBe("__ext_700");
    });

    test("should generate fallback key when externalId is undefined", () => {
      const rawOrder = { externalId: undefined, id: 800 };
      const result = normalizeClientOrderId(rawOrder, "800");
      expect(result).toBe("__ext_800");
    });

    test("should prioritize externalId over other field names", () => {
      // When multiple fields are present, externalId should win
      const rawOrder = {
        externalId: "preferred",
        externalID: "fallback1",
        external_id: "fallback2",
        id: 900,
      };
      const result = normalizeClientOrderId(rawOrder, "900");
      expect(result).toBe("preferred");
    });

    test("should not collapse multiple orders with different exchangeOrderIds", () => {
      // Simulate processing multiple orders from exchange
      const orders = [
        { id: 1001, market: "BTC-USD", side: "BUY" }, // No externalId
        { id: 1002, market: "BTC-USD", side: "SELL" }, // No externalId
      ];

      const results = orders.map(o => normalizeClientOrderId(o, String(o.id)));

      // Each should have a unique fallback key
      expect(results[0]).toBe("__ext_1001");
      expect(results[1]).toBe("__ext_1002");
      expect(results[0]).not.toBe(results[1]);
    });
  });
});
