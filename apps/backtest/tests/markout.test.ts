/**
 * Markout Tests
 *
 * Requirements: 11.4
 * - Calculate markout based on mid price at fill time and t+10s
 * - BUY: positive markout when price goes up
 * - SELL: positive markout when price goes down
 * - Handle missing mid_t10s gracefully
 */

import { describe, expect, it } from "bun:test";
import { enrichFillsWithMarkout, calculateAverageMarkout } from "../src/report/markout";
import type { SimFill } from "../src/sim/sim-execution";
import type { MdBbo } from "@agentic-mm-bot/db";

// Helper to create mock BBO data
function createMockBbo(ts: Date, midPx: string): MdBbo {
  const mid = parseFloat(midPx);
  const spread = 0.5;
  return {
    id: crypto.randomUUID(),
    ts,
    exchange: "test",
    symbol: "TEST-USD",
    bestBidPx: (mid - spread / 2).toString(),
    bestBidSz: "10",
    bestAskPx: (mid + spread / 2).toString(),
    bestAskSz: "10",
    midPx,
    seq: null,
    ingestTs: ts,
    rawJson: null,
  };
}

// Helper to create mock fill
function createMockFill(ts: Date, side: "buy" | "sell", midT0: string): SimFill {
  return {
    ts,
    side,
    orderPx: "100",
    size: "1",
    midT0,
    mode: "NORMAL",
    reasonCodes: [],
  };
}

describe("enrichFillsWithMarkout", () => {
  describe("BUY markout", () => {
    it("should calculate positive markout when price goes up", () => {
      const fillTime = new Date("2024-01-01T00:00:00Z");
      const t10s = new Date("2024-01-01T00:00:10Z");

      const fills: SimFill[] = [createMockFill(fillTime, "buy", "100")];
      const bboData: MdBbo[] = [
        createMockBbo(fillTime, "100"),
        createMockBbo(t10s, "101"), // Price went up 1%
      ];

      const enriched = enrichFillsWithMarkout(fills, bboData);

      expect(enriched.length).toBe(1);
      expect(enriched[0].midT10s).toBe("101");
      // BUY: (101 - 100) / 100 * 10000 = 100 bps
      expect(enriched[0].markout10sBps).toBeCloseTo(100, 2);
    });

    it("should calculate negative markout when price goes down", () => {
      const fillTime = new Date("2024-01-01T00:00:00Z");
      const t10s = new Date("2024-01-01T00:00:10Z");

      const fills: SimFill[] = [createMockFill(fillTime, "buy", "100")];
      const bboData: MdBbo[] = [
        createMockBbo(fillTime, "100"),
        createMockBbo(t10s, "99"), // Price went down 1%
      ];

      const enriched = enrichFillsWithMarkout(fills, bboData);

      expect(enriched.length).toBe(1);
      // BUY: (99 - 100) / 100 * 10000 = -100 bps
      expect(enriched[0].markout10sBps).toBeCloseTo(-100, 2);
    });
  });

  describe("SELL markout", () => {
    it("should calculate positive markout when price goes down", () => {
      const fillTime = new Date("2024-01-01T00:00:00Z");
      const t10s = new Date("2024-01-01T00:00:10Z");

      const fills: SimFill[] = [createMockFill(fillTime, "sell", "100")];
      const bboData: MdBbo[] = [
        createMockBbo(fillTime, "100"),
        createMockBbo(t10s, "99"), // Price went down 1%
      ];

      const enriched = enrichFillsWithMarkout(fills, bboData);

      expect(enriched.length).toBe(1);
      // SELL: (100 - 99) / 100 * 10000 = 100 bps
      expect(enriched[0].markout10sBps).toBeCloseTo(100, 2);
    });

    it("should calculate negative markout when price goes up", () => {
      const fillTime = new Date("2024-01-01T00:00:00Z");
      const t10s = new Date("2024-01-01T00:00:10Z");

      const fills: SimFill[] = [createMockFill(fillTime, "sell", "100")];
      const bboData: MdBbo[] = [
        createMockBbo(fillTime, "100"),
        createMockBbo(t10s, "101"), // Price went up 1%
      ];

      const enriched = enrichFillsWithMarkout(fills, bboData);

      expect(enriched.length).toBe(1);
      // SELL: (100 - 101) / 100 * 10000 = -100 bps
      expect(enriched[0].markout10sBps).toBeCloseTo(-100, 2);
    });
  });

  describe("missing data handling", () => {
    it("should return null markout when no BBO data after fill time", () => {
      const fillTime = new Date("2024-01-01T00:00:00Z");
      const beforeFill = new Date("2024-01-01T00:00:00Z"); // Only BBO at fill time itself

      const fills: SimFill[] = [createMockFill(fillTime, "buy", "100")];
      // No BBO data at all after the fill time
      const bboData: MdBbo[] = [];

      const enriched = enrichFillsWithMarkout(fills, bboData);

      expect(enriched.length).toBe(1);
      expect(enriched[0].midT10s).toBeNull();
      expect(enriched[0].markout10sBps).toBeNull();
    });

    it("should use closest BBO before t+10s target", () => {
      const fillTime = new Date("2024-01-01T00:00:00Z");
      const t5s = new Date("2024-01-01T00:00:05Z"); // 5 seconds later

      const fills: SimFill[] = [createMockFill(fillTime, "buy", "100")];
      const bboData: MdBbo[] = [
        createMockBbo(fillTime, "100"),
        createMockBbo(t5s, "101"), // This is after fill but before t+10s
      ];

      const enriched = enrichFillsWithMarkout(fills, bboData);

      expect(enriched.length).toBe(1);
      // Should use the t5s BBO as it's the closest before t+10s
      expect(enriched[0].midT10s).toBe("101");
      expect(enriched[0].markout10sBps).toBeCloseTo(100, 2);
    });
  });
});

describe("calculateAverageMarkout", () => {
  it("should calculate average of valid markouts", () => {
    const enriched = [{ markout10sBps: 100 } as any, { markout10sBps: 50 } as any, { markout10sBps: -30 } as any];

    const avg = calculateAverageMarkout(enriched);

    // (100 + 50 - 30) / 3 = 40
    expect(avg).toBeCloseTo(40, 2);
  });

  it("should exclude null markouts from average", () => {
    const enriched = [{ markout10sBps: 100 } as any, { markout10sBps: null } as any, { markout10sBps: 50 } as any];

    const avg = calculateAverageMarkout(enriched);

    // (100 + 50) / 2 = 75
    expect(avg).toBeCloseTo(75, 2);
  });

  it("should return null when no valid markouts", () => {
    const enriched = [{ markout10sBps: null } as any, { markout10sBps: null } as any];

    const avg = calculateAverageMarkout(enriched);

    expect(avg).toBeNull();
  });

  it("should return null for empty array", () => {
    const avg = calculateAverageMarkout([]);

    expect(avg).toBeNull();
  });
});
