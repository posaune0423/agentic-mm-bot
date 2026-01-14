/**
 * Position Tracker Unit Tests
 *
 * Requirements: 4.6, 4.7, 4.8
 * - syncFromPosition() sets size/entryPrice/uPnL/lastUpdateMs
 * - updateFromFill() updates size with sign and clears stale entry/uPnL
 */

import { describe, expect, test, beforeEach } from "bun:test";

import { PositionTracker } from "../../src/services/position-tracker";
import type { FillEvent, PositionInfo } from "@agentic-mm-bot/adapters";

// ─────────────────────────────────────────────────────────────────────────────
// Helper factories
// ─────────────────────────────────────────────────────────────────────────────

function createPositionInfo(overrides: Partial<PositionInfo> = {}): PositionInfo {
  return {
    symbol: "BTC-USD",
    size: "1.5",
    entryPrice: "95000",
    unrealizedPnl: "500",
    updatedAt: new Date("2024-01-01T12:00:00Z"),
    ...overrides,
  };
}

function createFillEvent(overrides: Partial<FillEvent> = {}): FillEvent {
  return {
    type: "fill",
    ts: new Date("2024-01-01T12:01:00Z"),
    clientOrderId: "client-123",
    symbol: "BTC-USD",
    side: "buy",
    price: "95100",
    size: "0.1",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// syncFromPosition Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("PositionTracker.syncFromPosition", () => {
  let tracker: PositionTracker;

  beforeEach(() => {
    tracker = new PositionTracker();
  });

  test("should set all fields from position info", () => {
    const positionInfo = createPositionInfo();

    tracker.syncFromPosition(positionInfo);

    expect(tracker.getPosition().size).toBe("1.5");
    expect(tracker.getEntryPrice()).toBe("95000");
    expect(tracker.getUnrealizedPnl()).toBe("500");
    expect(tracker.getLastUpdateMs()).toBe(new Date("2024-01-01T12:00:00Z").getTime());
  });

  test("should handle position with undefined optional fields", () => {
    const positionInfo = createPositionInfo({
      entryPrice: undefined,
      unrealizedPnl: undefined,
    });

    tracker.syncFromPosition(positionInfo);

    expect(tracker.getPosition().size).toBe("1.5");
    expect(tracker.getEntryPrice()).toBeUndefined();
    expect(tracker.getUnrealizedPnl()).toBeUndefined();
  });

  test("should reset to zero position when null is passed", () => {
    // First sync with a position
    tracker.syncFromPosition(createPositionInfo());
    expect(tracker.getPosition().size).toBe("1.5");

    // Then sync with null (no open position)
    tracker.syncFromPosition(null);

    expect(tracker.getPosition().size).toBe("0");
    expect(tracker.getEntryPrice()).toBeUndefined();
    expect(tracker.getUnrealizedPnl()).toBeUndefined();
  });

  test("should handle negative position (short)", () => {
    const positionInfo = createPositionInfo({
      size: "-2.0",
      unrealizedPnl: "-300",
    });

    tracker.syncFromPosition(positionInfo);

    expect(tracker.getPosition().size).toBe("-2.0");
    expect(tracker.getPositionSize()).toBe(-2.0);
    expect(tracker.getUnrealizedPnl()).toBe("-300");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateFromFill Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("PositionTracker.updateFromFill", () => {
  let tracker: PositionTracker;

  beforeEach(() => {
    tracker = new PositionTracker();
    // Start with a synced position
    tracker.syncFromPosition(
      createPositionInfo({
        size: "1.0",
        entryPrice: "95000",
        unrealizedPnl: "100",
      }),
    );
  });

  test("should increase size on buy fill", () => {
    const fill = createFillEvent({ side: "buy", size: "0.5" });

    tracker.updateFromFill(fill);

    expect(tracker.getPosition().size).toBe("1.5");
    expect(tracker.getPositionSize()).toBe(1.5);
  });

  test("should decrease size on sell fill", () => {
    const fill = createFillEvent({ side: "sell", size: "0.3" });

    tracker.updateFromFill(fill);

    expect(tracker.getPosition().size).toBe("0.7");
    expect(tracker.getPositionSize()).toBeCloseTo(0.7, 10);
  });

  test("should allow position to go negative (short) on sell", () => {
    const fill = createFillEvent({ side: "sell", size: "2.0" });

    tracker.updateFromFill(fill);

    expect(tracker.getPositionSize()).toBe(-1.0);
  });

  test("should clear entryPrice after fill (stale data)", () => {
    expect(tracker.getEntryPrice()).toBe("95000");

    const fill = createFillEvent({ side: "buy", size: "0.1" });
    tracker.updateFromFill(fill);

    expect(tracker.getEntryPrice()).toBeUndefined();
  });

  test("should clear unrealizedPnl after fill (stale data)", () => {
    expect(tracker.getUnrealizedPnl()).toBe("100");

    const fill = createFillEvent({ side: "sell", size: "0.1" });
    tracker.updateFromFill(fill);

    expect(tracker.getUnrealizedPnl()).toBeUndefined();
  });

  test("should update lastUpdateMs from fill timestamp", () => {
    const fillTs = new Date("2024-01-01T13:30:00Z");
    const fill = createFillEvent({ ts: fillTs });

    tracker.updateFromFill(fill);

    expect(tracker.getLastUpdateMs()).toBe(fillTs.getTime());
  });

  test("should handle multiple consecutive fills", () => {
    // Start fresh
    tracker.syncFromPosition(createPositionInfo({ size: "0" }));

    // Buy 0.5
    tracker.updateFromFill(createFillEvent({ side: "buy", size: "0.5" }));
    expect(tracker.getPositionSize()).toBe(0.5);

    // Buy 0.3 more
    tracker.updateFromFill(createFillEvent({ side: "buy", size: "0.3" }));
    expect(tracker.getPositionSize()).toBeCloseTo(0.8, 10);

    // Sell 1.0 (go short)
    tracker.updateFromFill(createFillEvent({ side: "sell", size: "1.0" }));
    expect(tracker.getPositionSize()).toBeCloseTo(-0.2, 10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getPosition Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("PositionTracker.getPosition", () => {
  test("should return Position object with size only", () => {
    const tracker = new PositionTracker();
    tracker.syncFromPosition(createPositionInfo({ size: "2.5" }));

    const position = tracker.getPosition();

    expect(position).toEqual({ size: "2.5" });
    // Ensure entryPrice/uPnL are not in Position (they're separate getters)
    expect(Object.keys(position)).toEqual(["size"]);
  });

  test("should return zero size for fresh tracker", () => {
    const tracker = new PositionTracker();

    expect(tracker.getPosition().size).toBe("0");
    expect(tracker.getPositionSize()).toBe(0);
  });
});
