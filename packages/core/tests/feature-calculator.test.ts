/**
 * Feature Calculator Unit Tests
 *
 * Requirements: 6.1-6.6, 14.1
 */

import { describe, expect, test } from "bun:test";

import type { MidSnapshot, TradeData } from "../src/feature-calculator";
import {
  calculateLiqCount10s,
  calculateMarkIndexDivBps,
  calculateMid,
  calculateRealizedVol10s,
  calculateSpreadBps,
  calculateTradeImbalance1s,
  isDataStale,
} from "../src/feature-calculator";

describe("calculateMid", () => {
  test("should calculate mid price correctly", () => {
    const result = calculateMid("49000", "51000");
    expect(parseFloat(result)).toBe(50000);
  });

  test("should handle decimal prices", () => {
    const result = calculateMid("49999.5", "50000.5");
    expect(parseFloat(result)).toBe(50000);
  });
});

describe("calculateSpreadBps", () => {
  test("should calculate spread in bps", () => {
    const mid = "50000";
    const bid = "49950";
    const ask = "50050";
    // spread = (50050 - 49950) / 50000 * 10000 = 20 bps
    const result = calculateSpreadBps(bid, ask, mid);
    expect(parseFloat(result)).toBeCloseTo(20, 2);
  });

  test("should return 0 for zero mid", () => {
    const result = calculateSpreadBps("0", "0", "0");
    expect(result).toBe("0");
  });
});

describe("calculateTradeImbalance1s", () => {
  test("should return 0 for empty trades", () => {
    const result = calculateTradeImbalance1s([], "50000");
    expect(result).toBe("0");
  });

  test("should calculate positive imbalance for more buys", () => {
    const trades: TradeData[] = [
      { ts: 1000, px: "50010", sz: "2", side: "buy" },
      { ts: 1001, px: "49990", sz: "1", side: "sell" },
    ];
    // imbalance = (2 - 1) / 3 = 0.333
    const result = calculateTradeImbalance1s(trades, "50000");
    expect(parseFloat(result)).toBeCloseTo(0.3333, 2);
  });

  test("should calculate negative imbalance for more sells", () => {
    const trades: TradeData[] = [
      { ts: 1000, px: "50010", sz: "1", side: "buy" },
      { ts: 1001, px: "49990", sz: "3", side: "sell" },
    ];
    // imbalance = (1 - 3) / 4 = -0.5
    const result = calculateTradeImbalance1s(trades, "50000");
    expect(parseFloat(result)).toBeCloseTo(-0.5, 2);
  });

  test("should infer side from price vs mid when side is unknown", () => {
    const trades: TradeData[] = [
      { ts: 1000, px: "50010", sz: "1" }, // Above mid → buy
      { ts: 1001, px: "49990", sz: "1" }, // Below mid → sell
    ];
    // imbalance = (1 - 1) / 2 = 0
    const result = calculateTradeImbalance1s(trades, "50000");
    expect(parseFloat(result)).toBeCloseTo(0, 2);
  });
});

describe("calculateRealizedVol10s", () => {
  test("should return 0 for less than 2 snapshots", () => {
    const snapshots: MidSnapshot[] = [{ ts: 1000, midPx: "50000" }];
    const result = calculateRealizedVol10s(snapshots);
    expect(result).toBe("0");
  });

  test("should return 0 for constant prices", () => {
    const snapshots: MidSnapshot[] = [
      { ts: 1000, midPx: "50000" },
      { ts: 2000, midPx: "50000" },
      { ts: 3000, midPx: "50000" },
    ];
    const result = calculateRealizedVol10s(snapshots);
    expect(parseFloat(result)).toBe(0);
  });

  test("should calculate volatility for varying prices", () => {
    const snapshots: MidSnapshot[] = [
      { ts: 1000, midPx: "50000" },
      { ts: 2000, midPx: "50100" }, // +0.2%
      { ts: 3000, midPx: "49900" }, // -0.4%
      { ts: 4000, midPx: "50000" }, // +0.2%
    ];
    const result = calculateRealizedVol10s(snapshots);
    // Should be positive non-zero
    expect(parseFloat(result)).toBeGreaterThan(0);
  });
});

describe("calculateMarkIndexDivBps", () => {
  test("should return 0 when mark is undefined", () => {
    const result = calculateMarkIndexDivBps(undefined, "50000", "50000");
    expect(result).toBe("0");
  });

  test("should return 0 when index is undefined", () => {
    const result = calculateMarkIndexDivBps("50000", undefined, "50000");
    expect(result).toBe("0");
  });

  test("should calculate divergence in bps", () => {
    // div = |50100 - 49900| / 50000 * 10000 = 40 bps
    const result = calculateMarkIndexDivBps("50100", "49900", "50000");
    expect(parseFloat(result)).toBeCloseTo(40, 2);
  });
});

describe("calculateLiqCount10s", () => {
  test("should return 0 for empty trades", () => {
    const result = calculateLiqCount10s([]);
    expect(result).toBe(0);
  });

  test("should count only liq and delev trades", () => {
    const trades: TradeData[] = [
      { ts: 1000, px: "50000", sz: "1", type: "normal" },
      { ts: 1001, px: "50000", sz: "1", type: "liq" },
      { ts: 1002, px: "50000", sz: "1", type: "delev" },
      { ts: 1003, px: "50000", sz: "1", type: "normal" },
      { ts: 1004, px: "50000", sz: "1", type: "liq" },
    ];
    const result = calculateLiqCount10s(trades);
    expect(result).toBe(3);
  });
});

describe("isDataStale", () => {
  test("should return false when data is fresh", () => {
    const result = isDataStale(1000, 2000, 5000);
    expect(result).toBe(false);
  });

  test("should return true when data is stale", () => {
    const result = isDataStale(1000, 10000, 5000);
    expect(result).toBe(true);
  });

  test("should return false at exact threshold", () => {
    const result = isDataStale(1000, 6000, 5000);
    expect(result).toBe(false);
  });

  test("should return true just past threshold", () => {
    const result = isDataStale(1000, 6001, 5000);
    expect(result).toBe(true);
  });
});
