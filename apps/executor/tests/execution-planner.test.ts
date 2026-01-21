/**
 * Execution Planner Unit Tests
 *
 * Tests the diff-based execution planning logic including:
 * - SET_ORDERS intent handling
 * - Reject spike mitigation (MIN_REQUOTE_BPS, SIZE_CHANGE_THRESHOLD)
 * - Order matching and update decisions
 */

import { describe, expect, test } from "bun:test";

import type { DesiredOrder, StrategyParams } from "@agentic-mm-bot/core";
import { planSetOrdersExecution, planExecution } from "../src/services/execution-planner";
import type { TrackedOrder } from "../src/services/order-tracker";

const createDefaultParams = (): StrategyParams => ({
  baseHalfSpreadBps: "10",
  volSpreadGain: "1",
  toxSpreadGain: "1",
  quoteSizeUsd: "100",
  refreshIntervalMs: 1000,
  staleCancelMs: 5000,
  maxInventory: "1.0",
  inventorySkewGain: "5",
  pauseMarkIndexBps: "50",
  pauseLiqCount10s: 3,
});

let orderCounter = 0;
const createTrackedOrder = (side: "buy" | "sell", price: string, size: string, createdAtMs: number): TrackedOrder => ({
  clientOrderId: `ord_${Date.now()}_${++orderCounter}_test`,
  exchangeOrderId: `exch_${orderCounter}`,
  side,
  price,
  size,
  createdAtMs,
});

const createDesiredOrder = (
  side: "buy" | "sell",
  price: string,
  size: string,
  kind: "quote" | "unwind" = "quote",
): DesiredOrder => ({
  side,
  price,
  size,
  postOnly: kind === "quote",
  reduceOnly: kind === "unwind",
  timeInForce: kind === "quote" ? "GTC" : "IOC",
  kind,
  reasonCodes: ["NORMAL_CONDITIONS"],
});

describe("planSetOrdersExecution", () => {
  describe("empty orders handling", () => {
    test("should return cancel_all when desired is empty and current has orders", () => {
      const currentOrders: TrackedOrder[] = [
        createTrackedOrder("buy", "49950", "0.001", Date.now()),
        createTrackedOrder("sell", "50050", "0.001", Date.now()),
      ];

      const actions = planSetOrdersExecution([], currentOrders, undefined, Date.now(), createDefaultParams(), "50000");

      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("cancel_all");
    });

    test("should return empty actions when both desired and current are empty", () => {
      const actions = planSetOrdersExecution([], [], undefined, Date.now(), createDefaultParams(), "50000");

      expect(actions).toHaveLength(0);
    });
  });

  describe("reject spike mitigation - price threshold", () => {
    test("should NOT update order when price diff is below MIN_REQUOTE_BPS (2 bps)", () => {
      const nowMs = Date.now();
      const params = createDefaultParams();
      const midPx = "50000";

      // Current bid at 49950, desired at 49951 (0.002% diff = 0.2 bps < 2 bps)
      const currentOrders: TrackedOrder[] = [createTrackedOrder("buy", "49950.00000000", "0.001", nowMs - 100)];

      const desiredOrders: DesiredOrder[] = [createDesiredOrder("buy", "49951.00000000", "0.001")];

      const actions = planSetOrdersExecution(
        desiredOrders,
        currentOrders,
        nowMs - 2000, // Last quote 2s ago (> refresh interval)
        nowMs,
        params,
        midPx,
      );

      // Should NOT cancel+place because price diff is < 2 bps
      const placeActions = actions.filter(a => a.type === "place");
      const cancelActions = actions.filter(a => a.type === "cancel");
      expect(placeActions).toHaveLength(0);
      expect(cancelActions).toHaveLength(0);
    });

    test("should update order when price diff exceeds MIN_REQUOTE_BPS (2 bps)", () => {
      const nowMs = Date.now();
      const params = createDefaultParams();
      const midPx = "50000";

      // Current bid at 49950, desired at 49930 (0.04% diff = 4 bps > 2 bps)
      const currentOrders: TrackedOrder[] = [createTrackedOrder("buy", "49950.00000000", "0.001", nowMs - 100)];

      const desiredOrders: DesiredOrder[] = [createDesiredOrder("buy", "49930.00000000", "0.001")];

      const actions = planSetOrdersExecution(desiredOrders, currentOrders, nowMs - 2000, nowMs, params, midPx);

      // Should cancel+place because price diff > 2 bps
      const placeActions = actions.filter(a => a.type === "place");
      const cancelActions = actions.filter(a => a.type === "cancel");
      expect(cancelActions).toHaveLength(1);
      expect(placeActions).toHaveLength(1);
    });
  });

  describe("reject spike mitigation - size threshold", () => {
    test("should NOT update order when size diff is below 10%", () => {
      const nowMs = Date.now();
      const params = createDefaultParams();
      const midPx = "50000";

      // Current size 0.001, desired 0.00105 (5% diff < 10%)
      const currentOrders: TrackedOrder[] = [createTrackedOrder("buy", "49950.00000000", "0.001000", nowMs - 100)];

      const desiredOrders: DesiredOrder[] = [createDesiredOrder("buy", "49950.00000000", "0.001050")];

      const actions = planSetOrdersExecution(desiredOrders, currentOrders, nowMs - 2000, nowMs, params, midPx);

      // Should NOT update because size diff < 10%
      const placeActions = actions.filter(a => a.type === "place");
      expect(placeActions).toHaveLength(0);
    });

    test("should update order when size diff exceeds 10%", () => {
      const nowMs = Date.now();
      const params = createDefaultParams();
      const midPx = "50000";

      // Current size 0.001, desired 0.0015 (50% diff > 10%)
      const currentOrders: TrackedOrder[] = [createTrackedOrder("buy", "49950.00000000", "0.001000", nowMs - 100)];

      const desiredOrders: DesiredOrder[] = [createDesiredOrder("buy", "49950.00000000", "0.001500")];

      const actions = planSetOrdersExecution(desiredOrders, currentOrders, nowMs - 2000, nowMs, params, midPx);

      // Should cancel+place because size diff > 10%
      const cancelActions = actions.filter(a => a.type === "cancel");
      const placeActions = actions.filter(a => a.type === "place");
      expect(cancelActions).toHaveLength(1);
      expect(placeActions).toHaveLength(1);
    });
  });

  describe("refresh interval enforcement", () => {
    test("should place new orders when no current orders (even if refresh interval not elapsed)", () => {
      const nowMs = Date.now();
      const params = { ...createDefaultParams(), refreshIntervalMs: 1000 };
      const midPx = "50000";

      // No current orders, but refresh interval not elapsed
      const desiredOrders: DesiredOrder[] = [createDesiredOrder("buy", "49950.00000000", "0.001")];

      const actions = planSetOrdersExecution(
        desiredOrders,
        [],
        nowMs - 500, // Last quote 500ms ago (< 1000ms refresh)
        nowMs,
        params,
        midPx,
      );

      // If there are no current orders, we must allow placement even if last quote was recent
      // (otherwise a single reject/cancel can stall quoting indefinitely).
      const placeActions = actions.filter(a => a.type === "place");
      expect(placeActions).toHaveLength(1);
    });

    test("should place new orders when refresh interval elapsed", () => {
      const nowMs = Date.now();
      const params = { ...createDefaultParams(), refreshIntervalMs: 1000 };
      const midPx = "50000";

      // No current orders, refresh interval elapsed
      const desiredOrders: DesiredOrder[] = [createDesiredOrder("buy", "49950.00000000", "0.001")];

      const actions = planSetOrdersExecution(
        desiredOrders,
        [],
        nowMs - 1500, // Last quote 1.5s ago (> 1s refresh)
        nowMs,
        params,
        midPx,
      );

      const placeActions = actions.filter(a => a.type === "place");
      expect(placeActions).toHaveLength(1);
    });
  });

  describe("stale order handling", () => {
    test("should cancel and replace stale orders", () => {
      const nowMs = Date.now();
      const params = { ...createDefaultParams(), staleCancelMs: 5000 };
      const midPx = "50000";

      // Order created 6s ago (> 5s stale threshold)
      const currentOrders: TrackedOrder[] = [createTrackedOrder("buy", "49950.00000000", "0.001", nowMs - 6000)];

      const desiredOrders: DesiredOrder[] = [createDesiredOrder("buy", "49950.00000000", "0.001")];

      const actions = planSetOrdersExecution(desiredOrders, currentOrders, nowMs - 2000, nowMs, params, midPx);

      // Should cancel+place because order is stale
      const cancelActions = actions.filter(a => a.type === "cancel");
      const placeActions = actions.filter(a => a.type === "place");
      expect(cancelActions).toHaveLength(1);
      expect(placeActions).toHaveLength(1);
    });
  });

  describe("unwind order handling", () => {
    test("should always place unwind orders (never match with existing)", () => {
      const nowMs = Date.now();
      const params = createDefaultParams();
      const midPx = "50000";

      // Have a sell quote order
      const currentOrders: TrackedOrder[] = [createTrackedOrder("sell", "50050.00000000", "0.001", nowMs - 100)];

      // Want a sell unwind order (should be placed fresh, not matched)
      const desiredOrders: DesiredOrder[] = [createDesiredOrder("sell", "50000.00000000", "0.0005", "unwind")];

      const actions = planSetOrdersExecution(desiredOrders, currentOrders, nowMs - 2000, nowMs, params, midPx);

      // Should cancel the existing sell (not matched by unwind) and place unwind
      const placeActions = actions.filter(a => a.type === "place");
      expect(placeActions).toHaveLength(1);
      if (placeActions[0].type === "place") {
        expect(placeActions[0].reduceOnly).toBe(true);
        expect(placeActions[0].timeInForce).toBe("IOC");
      }
    });
  });

  describe("cancel unmatched orders", () => {
    test("should cancel current orders not matched by any desired order", () => {
      const nowMs = Date.now();
      const params = createDefaultParams();
      const midPx = "50000";

      // Have bid and ask
      const currentOrders: TrackedOrder[] = [
        createTrackedOrder("buy", "49950.00000000", "0.001", nowMs - 100),
        createTrackedOrder("sell", "50050.00000000", "0.001", nowMs - 100),
      ];

      // Only want bid (one-sided quoting)
      const desiredOrders: DesiredOrder[] = [createDesiredOrder("buy", "49950.00000000", "0.001")];

      const actions = planSetOrdersExecution(desiredOrders, currentOrders, nowMs - 2000, nowMs, params, midPx);

      // Should cancel the unmatched sell order
      const cancelActions = actions.filter(a => a.type === "cancel");
      expect(cancelActions).toHaveLength(1);
    });
  });
});

describe("planExecution with SET_ORDERS intent", () => {
  test("should handle SET_ORDERS intent correctly", () => {
    const nowMs = Date.now();
    const params = createDefaultParams();
    const midPx = "50000";

    const intent = {
      type: "SET_ORDERS" as const,
      orders: [
        createDesiredOrder("buy", "49950.00000000", "0.001"),
        createDesiredOrder("sell", "50050.00000000", "0.001"),
      ],
      reasonCodes: ["NORMAL_CONDITIONS" as const],
    };

    const actions = planExecution(intent, undefined, undefined, undefined, nowMs, params, midPx);

    const placeActions = actions.filter(a => a.type === "place");
    expect(placeActions).toHaveLength(2);
  });
});
