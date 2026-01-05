/**
 * Quote Calculator Unit Tests
 *
 * Requirements: 7.2-7.4, 14.1
 */

import { describe, expect, test } from "bun:test";

import type { Features, Position, StrategyParams } from "../src/types";
import {
  calculateHalfSpreadBps,
  calculateQuotePrices,
  calculateSkewBps,
  generateQuoteIntent,
} from "../src/quote-calculator";

const createDefaultParams = (): StrategyParams => ({
  baseHalfSpreadBps: "10",
  volSpreadGain: "1",
  toxSpreadGain: "2",
  quoteSizeBase: "0.1",
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

describe("generateQuoteIntent", () => {
  test("should generate a QUOTE intent with correct structure", () => {
    const params = createDefaultParams();
    const features = createDefaultFeatures();
    const position = createDefaultPosition();

    const result = generateQuoteIntent(params, features, position, ["NORMAL_CONDITIONS"]);

    expect(result.type).toBe("QUOTE");
    expect(result.postOnly).toBe(true);
    expect(result.size).toBe(params.quoteSizeBase);
    expect(result.reasonCodes).toContain("NORMAL_CONDITIONS");
    expect(parseFloat(result.bidPx)).toBeLessThan(parseFloat(features.midPx));
    expect(parseFloat(result.askPx)).toBeGreaterThan(parseFloat(features.midPx));
  });
});
