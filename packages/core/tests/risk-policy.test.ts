/**
 * Risk Policy Unit Tests
 *
 * Requirements: 5.2-5.6, 8.1-8.2, 14.1
 */

import { describe, expect, test } from "bun:test";

import type { Features, Position, StrategyParams } from "../src/types";
import { calculatePauseUntil, evaluateRisk, isPauseDurationElapsed, PAUSE_MIN_DURATION_MS } from "../src/risk-policy";

const createDefaultParams = (): StrategyParams => ({
  baseHalfSpreadBps: "10",
  volSpreadGain: "1",
  toxSpreadGain: "1",
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

describe("evaluateRisk", () => {
  describe("PAUSE conditions (highest priority)", () => {
    test("should return shouldPause=true when data is stale", () => {
      const features: Features = { ...createDefaultFeatures(), dataStale: true };
      const result = evaluateRisk(features, createDefaultPosition(), createDefaultParams());

      expect(result.shouldPause).toBe(true);
      expect(result.reasonCodes).toContain("DATA_STALE");
    });

    test("should return shouldPause=true when mark-index divergence exceeds threshold", () => {
      const features: Features = { ...createDefaultFeatures(), markIndexDivBps: "60" };
      const params = createDefaultParams();
      const result = evaluateRisk(features, createDefaultPosition(), params);

      expect(result.shouldPause).toBe(true);
      expect(result.reasonCodes).toContain("MARK_INDEX_DIVERGED");
    });

    test("should return shouldPause=true when liquidation count exceeds threshold", () => {
      const features: Features = { ...createDefaultFeatures(), liqCount10s: 5 };
      const params = createDefaultParams();
      const result = evaluateRisk(features, createDefaultPosition(), params);

      expect(result.shouldPause).toBe(true);
      expect(result.reasonCodes).toContain("LIQUIDATION_SPIKE");
    });

    test("should return shouldPause=true when inventory exceeds max", () => {
      const position: Position = { size: "1.5" };
      const params = createDefaultParams();
      const result = evaluateRisk(createDefaultFeatures(), position, params);

      expect(result.shouldPause).toBe(true);
      expect(result.reasonCodes).toContain("INVENTORY_LIMIT");
    });

    test("should return shouldPause=true when inventory is negative and exceeds max", () => {
      const position: Position = { size: "-1.5" };
      const params = createDefaultParams();
      const result = evaluateRisk(createDefaultFeatures(), position, params);

      expect(result.shouldPause).toBe(true);
      expect(result.reasonCodes).toContain("INVENTORY_LIMIT");
    });
  });

  describe("DEFENSIVE conditions", () => {
    test("should return shouldDefensive=true when volatility is high", () => {
      const features: Features = { ...createDefaultFeatures(), realizedVol10s: "60" };
      const result = evaluateRisk(features, createDefaultPosition(), createDefaultParams());

      expect(result.shouldPause).toBe(false);
      expect(result.shouldDefensive).toBe(true);
      expect(result.reasonCodes).toContain("DEFENSIVE_VOL");
    });

    test("should return shouldDefensive=true when toxicity is high", () => {
      const features: Features = { ...createDefaultFeatures(), tradeImbalance1s: "0.8" };
      const result = evaluateRisk(features, createDefaultPosition(), createDefaultParams());

      expect(result.shouldPause).toBe(false);
      expect(result.shouldDefensive).toBe(true);
      expect(result.reasonCodes).toContain("DEFENSIVE_TOX");
    });
  });

  describe("NORMAL conditions", () => {
    test("should return both false when all conditions are normal", () => {
      const result = evaluateRisk(createDefaultFeatures(), createDefaultPosition(), createDefaultParams());

      expect(result.shouldPause).toBe(false);
      expect(result.shouldDefensive).toBe(false);
      expect(result.reasonCodes).toContain("NORMAL_CONDITIONS");
    });
  });

  describe("priority", () => {
    test("PAUSE should take priority over DEFENSIVE", () => {
      const features: Features = {
        ...createDefaultFeatures(),
        dataStale: true, // PAUSE condition
        realizedVol10s: "60", // DEFENSIVE condition
      };
      const result = evaluateRisk(features, createDefaultPosition(), createDefaultParams());

      expect(result.shouldPause).toBe(true);
      expect(result.shouldDefensive).toBe(false);
    });
  });
});

describe("isPauseDurationElapsed", () => {
  test("should return true when pauseUntilMs is undefined", () => {
    expect(isPauseDurationElapsed(undefined, Date.now())).toBe(true);
  });

  test("should return false when current time is before pauseUntil", () => {
    const now = 1000;
    const pauseUntil = 2000;
    expect(isPauseDurationElapsed(pauseUntil, now)).toBe(false);
  });

  test("should return true when current time is after pauseUntil", () => {
    const now = 3000;
    const pauseUntil = 2000;
    expect(isPauseDurationElapsed(pauseUntil, now)).toBe(true);
  });

  test("should return true when current time equals pauseUntil", () => {
    const now = 2000;
    const pauseUntil = 2000;
    expect(isPauseDurationElapsed(pauseUntil, now)).toBe(true);
  });
});

describe("calculatePauseUntil", () => {
  test("should add PAUSE_MIN_DURATION_MS to current time", () => {
    const now = 1000;
    const result = calculatePauseUntil(now);
    expect(result).toBe(now + PAUSE_MIN_DURATION_MS);
  });
});
