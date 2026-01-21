/**
 * Quote Calculator Unit Tests
 *
 * Requirements: 7.2-7.4, 14.1
 */

import { describe, expect, test } from "bun:test";

import type { Features, Position, RiskEvaluation, StrategyParams } from "../src/types";
import {
  calculateHalfSpreadBps,
  calculateQuotePrices,
  calculateSkewBps,
  generateDesiredOrders,
} from "../src/quote-calculator";

const createDefaultParams = (): StrategyParams => ({
  baseHalfSpreadBps: "10",
  volSpreadGain: "1",
  toxSpreadGain: "2",
  quoteSizeUsd: "10",
  refreshIntervalMs: 1000,
  staleCancelMs: 5000,
  maxInventory: "1.0",
  inventorySkewGain: "5",
  pauseMarkIndexBps: "50",
  pauseLiqCount10s: 3,
});

const createDefaultFeatures = (): Features => ({
  midPx: "50000",
  spreadBps: "5",
  tradeImbalance1s: "0.1",
  realizedVol10s: "10",
  markIndexDivBps: "10",
  liqCount10s: 0,
  dataStale: false,
});

const createDefaultPosition = (): Position => ({
  size: "0",
});

describe("calculateHalfSpreadBps", () => {
  test("should calculate half spread with base, vol, and tox components", () => {
    const params = createDefaultParams();
    const features: Features = {
      ...createDefaultFeatures(),
      realizedVol10s: "20", // 20 bps vol
      tradeImbalance1s: "0.5", // 50% imbalance
    };

    // base(10) + vol_gain(1) * vol(20) + tox_gain(2) * abs(imbalance)(0.5)
    // = 10 + 20 + 1 = 31
    const result = calculateHalfSpreadBps(params, features);
    expect(result).toBe(31);
  });

  test("should handle negative imbalance (use absolute value)", () => {
    const params = createDefaultParams();
    const features: Features = {
      ...createDefaultFeatures(),
      realizedVol10s: "0",
      tradeImbalance1s: "-0.5",
    };

    // base(10) + vol_gain(1) * vol(0) + tox_gain(2) * abs(imbalance)(0.5)
    // = 10 + 0 + 1 = 11
    const result = calculateHalfSpreadBps(params, features);
    expect(result).toBe(11);
  });
});

describe("calculateSkewBps", () => {
  test("should return positive skew for positive inventory", () => {
    const params = createDefaultParams();
    const position: Position = { size: "0.5" };

    // skew_gain(5) * inventory(0.5) = 2.5
    const result = calculateSkewBps(params, position);
    expect(result).toBe(2.5);
  });

  test("should return negative skew for negative inventory", () => {
    const params = createDefaultParams();
    const position: Position = { size: "-0.5" };

    // skew_gain(5) * inventory(-0.5) = -2.5
    const result = calculateSkewBps(params, position);
    expect(result).toBe(-2.5);
  });

  test("should return zero skew for zero inventory", () => {
    const params = createDefaultParams();
    const position: Position = { size: "0" };

    const result = calculateSkewBps(params, position);
    expect(result).toBe(0);
  });
});

describe("calculateQuotePrices", () => {
  test("should calculate bid and ask prices around mid", () => {
    const params: StrategyParams = {
      ...createDefaultParams(),
      baseHalfSpreadBps: "10",
      volSpreadGain: "0",
      toxSpreadGain: "0",
      inventorySkewGain: "0",
    };
    const features: Features = {
      ...createDefaultFeatures(),
      midPx: "50000",
      realizedVol10s: "0",
      tradeImbalance1s: "0",
    };
    const position = createDefaultPosition();

    const result = calculateQuotePrices(params, features, position);

    // halfSpread = 10 bps = 50000 * 10 / 10000 = 50
    // bid = 50000 - 50 = 49950
    // ask = 50000 + 50 = 50050
    expect(parseFloat(result.bidPx)).toBeCloseTo(49950, 0);
    expect(parseFloat(result.askPx)).toBeCloseTo(50050, 0);
  });

  test("should apply inventory skew to shift quotes", () => {
    const params: StrategyParams = {
      ...createDefaultParams(),
      baseHalfSpreadBps: "10",
      volSpreadGain: "0",
      toxSpreadGain: "0",
      inventorySkewGain: "10", // 10 bps per unit
    };
    const features: Features = {
      ...createDefaultFeatures(),
      midPx: "50000",
      realizedVol10s: "0",
      tradeImbalance1s: "0",
    };
    const position: Position = { size: "1" }; // Long 1 unit

    const result = calculateQuotePrices(params, features, position);

    // halfSpread = 10 bps = 50
    // skew = 10 bps * 1 = 50
    // bid = 50000 - 50 - 50 = 49900 (shifted down to discourage buying)
    // ask = 50000 + 50 - 50 = 50000 (shifted down)
    expect(parseFloat(result.bidPx)).toBeCloseTo(49900, 0);
    expect(parseFloat(result.askPx)).toBeCloseTo(50000, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateDesiredOrders tests (attack-defense logic)
// ─────────────────────────────────────────────────────────────────────────────

const createDefaultRisk = (): RiskEvaluation => ({
  shouldPause: false,
  shouldDefensive: false,
  reasonCodes: ["NORMAL_CONDITIONS"],
  riskScore: 0,
});

const createDefensiveRisk = (): RiskEvaluation => ({
  shouldPause: false,
  shouldDefensive: true,
  reasonCodes: ["DEFENSIVE_VOL"],
  riskScore: 0.8,
});

describe("generateDesiredOrders", () => {
  describe("basic behavior", () => {
    test("should generate bid and ask orders in NORMAL mode", () => {
      const params = createDefaultParams();
      const features = createDefaultFeatures();
      const position = createDefaultPosition();
      const risk = createDefaultRisk();
      const nowMs = Date.now();

      const orders = generateDesiredOrders(params, features, position, risk, nowMs);

      expect(orders).toHaveLength(2);
      expect(orders.find(o => o.side === "buy")).toBeDefined();
      expect(orders.find(o => o.side === "sell")).toBeDefined();
      expect(orders.every(o => o.kind === "quote")).toBe(true);
      expect(orders.every(o => o.postOnly === true)).toBe(true);
      expect(orders.every(o => o.reduceOnly === false)).toBe(true);
      expect(orders.every(o => o.timeInForce === "GTC")).toBe(true);
    });

    test("should return empty array for invalid mid price", () => {
      const params = createDefaultParams();
      const features = { ...createDefaultFeatures(), midPx: "0" };
      const position = createDefaultPosition();
      const risk = createDefaultRisk();
      const nowMs = Date.now();

      const orders = generateDesiredOrders(params, features, position, risk, nowMs);

      expect(orders).toHaveLength(0);
    });
  });

  describe("one-sided quoting", () => {
    test("should only generate ask when long inventory exceeds threshold", () => {
      const params: StrategyParams = {
        ...createDefaultParams(),
        maxInventory: "1.0",
        oneSidedThreshold: "0.3", // 30% of maxInventory = 0.3
      };
      const features = createDefaultFeatures();
      const position: Position = { size: "0.5" }; // > 0.3 threshold
      const risk = createDefaultRisk();
      const nowMs = Date.now();

      const orders = generateDesiredOrders(params, features, position, risk, nowMs);

      // Long position → stop buying (only ask)
      expect(orders.filter(o => o.kind === "quote")).toHaveLength(1);
      expect(orders.find(o => o.side === "sell" && o.kind === "quote")).toBeDefined();
      expect(orders.find(o => o.side === "buy" && o.kind === "quote")).toBeUndefined();
    });

    test("should only generate bid when short inventory exceeds threshold", () => {
      const params: StrategyParams = {
        ...createDefaultParams(),
        maxInventory: "1.0",
        oneSidedThreshold: "0.3",
      };
      const features = createDefaultFeatures();
      const position: Position = { size: "-0.5" }; // < -0.3 threshold
      const risk = createDefaultRisk();
      const nowMs = Date.now();

      const orders = generateDesiredOrders(params, features, position, risk, nowMs);

      // Short position → stop selling (only bid)
      expect(orders.filter(o => o.kind === "quote")).toHaveLength(1);
      expect(orders.find(o => o.side === "buy" && o.kind === "quote")).toBeDefined();
      expect(orders.find(o => o.side === "sell" && o.kind === "quote")).toBeUndefined();
    });

    test("should generate both sides when inventory is below threshold", () => {
      const params: StrategyParams = {
        ...createDefaultParams(),
        maxInventory: "1.0",
        oneSidedThreshold: "0.3",
      };
      const features = createDefaultFeatures();
      const position: Position = { size: "0.2" }; // < 0.3 threshold
      const risk = createDefaultRisk();
      const nowMs = Date.now();

      const orders = generateDesiredOrders(params, features, position, risk, nowMs);

      expect(orders.filter(o => o.kind === "quote")).toHaveLength(2);
    });
  });

  describe("defensive mode", () => {
    test("should widen spread in DEFENSIVE mode", () => {
      const params: StrategyParams = {
        ...createDefaultParams(),
        baseHalfSpreadBps: "10",
        volSpreadGain: "0",
        toxSpreadGain: "0",
        inventorySkewGain: "0",
        defensiveSpreadMultiplier: "1.5", // 1.5x wider
      };
      const features: Features = {
        ...createDefaultFeatures(),
        midPx: "50000",
        realizedVol10s: "0",
        tradeImbalance1s: "0",
      };
      const position = createDefaultPosition();
      const nowMs = Date.now();

      // Normal mode
      const normalRisk = createDefaultRisk();
      const normalOrders = generateDesiredOrders(params, features, position, normalRisk, nowMs);
      const normalBid = normalOrders.find(o => o.side === "buy")!;
      const normalAsk = normalOrders.find(o => o.side === "sell")!;
      const normalSpread = parseFloat(normalAsk.price) - parseFloat(normalBid.price);

      // Defensive mode
      const defensiveRisk = createDefensiveRisk();
      const defensiveOrders = generateDesiredOrders(params, features, position, defensiveRisk, nowMs);
      const defensiveBid = defensiveOrders.find(o => o.side === "buy")!;
      const defensiveAsk = defensiveOrders.find(o => o.side === "sell")!;
      const defensiveSpread = parseFloat(defensiveAsk.price) - parseFloat(defensiveBid.price);

      // Defensive spread should be 1.5x wider
      expect(defensiveSpread).toBeCloseTo(normalSpread * 1.5, 0);
    });

    test("should reduce size in DEFENSIVE mode", () => {
      const params: StrategyParams = {
        ...createDefaultParams(),
        quoteSizeUsd: "100",
        defensiveSizeMultiplier: "0.5", // 50% size
      };
      const features = createDefaultFeatures();
      const position = createDefaultPosition();
      const nowMs = Date.now();

      // Normal mode
      const normalRisk = createDefaultRisk();
      const normalOrders = generateDesiredOrders(params, features, position, normalRisk, nowMs);
      const normalSize = parseFloat(normalOrders[0].size);

      // Defensive mode
      const defensiveRisk = createDefensiveRisk();
      const defensiveOrders = generateDesiredOrders(params, features, position, defensiveRisk, nowMs);
      const defensiveSize = parseFloat(defensiveOrders[0].size);

      // Defensive size should be 50% of normal
      expect(defensiveSize).toBeCloseTo(normalSize * 0.5, 4);
    });
  });

  describe("unwind orders", () => {
    test("should generate unwind order when position held longer than trigger", () => {
      const params: StrategyParams = {
        ...createDefaultParams(),
        unwindTriggerMs: 30000, // 30 seconds
        unwindSizeRatio: "0.25", // 25%
      };
      const features = createDefaultFeatures();
      const nowMs = Date.now();
      const position: Position = {
        size: "1.0",
        positionSinceMs: nowMs - 35000, // 35 seconds ago (> 30s trigger)
      };
      const risk = createDefaultRisk();

      const orders = generateDesiredOrders(params, features, position, risk, nowMs);

      // Should have 2 quote orders + 1 unwind order
      const quoteOrders = orders.filter(o => o.kind === "quote");
      const unwindOrders = orders.filter(o => o.kind === "unwind");

      expect(unwindOrders).toHaveLength(1);
      expect(unwindOrders[0].side).toBe("sell"); // Long position → sell to unwind
      expect(unwindOrders[0].reduceOnly).toBe(true);
      expect(unwindOrders[0].timeInForce).toBe("IOC");
      expect(unwindOrders[0].postOnly).toBe(false);
      expect(parseFloat(unwindOrders[0].size)).toBeCloseTo(0.25, 4); // 25% of 1.0
    });

    test("should not generate unwind order when position held less than trigger", () => {
      const params: StrategyParams = {
        ...createDefaultParams(),
        unwindTriggerMs: 30000,
      };
      const features = createDefaultFeatures();
      const nowMs = Date.now();
      const position: Position = {
        size: "1.0",
        positionSinceMs: nowMs - 10000, // Only 10 seconds (< 30s trigger)
      };
      const risk = createDefaultRisk();

      const orders = generateDesiredOrders(params, features, position, risk, nowMs);

      const unwindOrders = orders.filter(o => o.kind === "unwind");
      expect(unwindOrders).toHaveLength(0);
    });

    test("should not generate unwind order when no position", () => {
      const params: StrategyParams = {
        ...createDefaultParams(),
        unwindTriggerMs: 30000,
      };
      const features = createDefaultFeatures();
      const nowMs = Date.now();
      const position: Position = { size: "0" };
      const risk = createDefaultRisk();

      const orders = generateDesiredOrders(params, features, position, risk, nowMs);

      const unwindOrders = orders.filter(o => o.kind === "unwind");
      expect(unwindOrders).toHaveLength(0);
    });

    test("should generate buy unwind for short position", () => {
      const params: StrategyParams = {
        ...createDefaultParams(),
        unwindTriggerMs: 30000,
        unwindSizeRatio: "0.25",
      };
      const features = createDefaultFeatures();
      const nowMs = Date.now();
      const position: Position = {
        size: "-1.0", // Short
        positionSinceMs: nowMs - 35000,
      };
      const risk = createDefaultRisk();

      const orders = generateDesiredOrders(params, features, position, risk, nowMs);

      const unwindOrders = orders.filter(o => o.kind === "unwind");
      expect(unwindOrders).toHaveLength(1);
      expect(unwindOrders[0].side).toBe("buy"); // Short position → buy to unwind
    });
  });
});
