/**
 * Strategy Engine Unit Tests
 *
 * Requirements: 5.1-5.7, 7.5, 14.1
 */

import { describe, expect, test } from "bun:test";

import type { DecideInput, Features, Position, StrategyParams, StrategyState } from "../src/types";
import { createInitialState, decide } from "../src/strategy-engine";
import { PAUSE_MIN_DURATION_MS } from "../src/risk-policy";

const createDefaultParams = (): StrategyParams => ({
  baseHalfSpreadBps: "10",
  volSpreadGain: "1",
  toxSpreadGain: "1",
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

const createNormalState = (nowMs: number): StrategyState => ({
  mode: "NORMAL",
  modeSinceMs: nowMs - 60000,
  pauseUntilMs: undefined,
  lastQuoteMs: nowMs - 1000,
});

describe("decide", () => {
  describe("PAUSE mode behavior", () => {
    test("should generate CANCEL_ALL when in PAUSE mode", () => {
      const nowMs = Date.now();
      const input: DecideInput = {
        nowMs,
        state: {
          mode: "PAUSE",
          modeSinceMs: nowMs - 5000,
          pauseUntilMs: nowMs + 5000, // Still in pause
          lastQuoteMs: undefined,
        },
        features: createDefaultFeatures(),
        params: createDefaultParams(),
        position: createDefaultPosition(),
      };

      const result = decide(input);

      expect(result.nextState.mode).toBe("PAUSE");
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0].type).toBe("CANCEL_ALL");
    });

    test("should transition to PAUSE when data is stale", () => {
      const nowMs = Date.now();
      const input: DecideInput = {
        nowMs,
        state: createNormalState(nowMs),
        features: { ...createDefaultFeatures(), dataStale: true },
        params: createDefaultParams(),
        position: createDefaultPosition(),
      };

      const result = decide(input);

      expect(result.nextState.mode).toBe("PAUSE");
      expect(result.intents[0].type).toBe("CANCEL_ALL");
      expect(result.reasonCodes).toContain("DATA_STALE");
    });

    test("should stay in PAUSE until minimum duration elapsed (5.7)", () => {
      const nowMs = Date.now();
      const input: DecideInput = {
        nowMs,
        state: {
          mode: "PAUSE",
          modeSinceMs: nowMs - 1000, // Only 1 second ago
          pauseUntilMs: nowMs + PAUSE_MIN_DURATION_MS - 1000,
          lastQuoteMs: undefined,
        },
        features: createDefaultFeatures(), // Normal conditions
        params: createDefaultParams(),
        position: createDefaultPosition(),
      };

      const result = decide(input);

      expect(result.nextState.mode).toBe("PAUSE");
    });

    test("should exit PAUSE to DEFENSIVE when duration elapsed (5.6)", () => {
      const nowMs = Date.now();
      const input: DecideInput = {
        nowMs,
        state: {
          mode: "PAUSE",
          modeSinceMs: nowMs - PAUSE_MIN_DURATION_MS - 1000,
          pauseUntilMs: nowMs - 1000, // Already elapsed
          lastQuoteMs: undefined,
        },
        features: createDefaultFeatures(), // Normal conditions
        params: createDefaultParams(),
        position: createDefaultPosition(),
      };

      const result = decide(input);

      // Should go to DEFENSIVE, not NORMAL (5.6)
      expect(result.nextState.mode).toBe("DEFENSIVE");
    });
  });

  describe("NORMAL mode behavior", () => {
    test("should generate QUOTE intent when in NORMAL mode", () => {
      const nowMs = Date.now();
      const input: DecideInput = {
        nowMs,
        state: createNormalState(nowMs),
        features: createDefaultFeatures(),
        params: createDefaultParams(),
        position: createDefaultPosition(),
      };

      const result = decide(input);

      expect(result.nextState.mode).toBe("NORMAL");
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0].type).toBe("QUOTE");
    });

    test("should transition to DEFENSIVE when volatility is high", () => {
      const nowMs = Date.now();
      const input: DecideInput = {
        nowMs,
        state: createNormalState(nowMs),
        features: { ...createDefaultFeatures(), realizedVol10s: "60" },
        params: createDefaultParams(),
        position: createDefaultPosition(),
      };

      const result = decide(input);

      expect(result.nextState.mode).toBe("DEFENSIVE");
      expect(result.reasonCodes).toContain("DEFENSIVE_VOL");
    });
  });

  describe("DEFENSIVE mode behavior", () => {
    test("should generate QUOTE intent when in DEFENSIVE mode", () => {
      const nowMs = Date.now();
      const input: DecideInput = {
        nowMs,
        state: {
          mode: "DEFENSIVE",
          modeSinceMs: nowMs - 5000,
          pauseUntilMs: undefined,
          lastQuoteMs: nowMs - 1000,
        },
        features: { ...createDefaultFeatures(), realizedVol10s: "60" }, // Still defensive
        params: createDefaultParams(),
        position: createDefaultPosition(),
      };

      const result = decide(input);

      expect(result.nextState.mode).toBe("DEFENSIVE");
      expect(result.intents[0].type).toBe("QUOTE");
    });

    test("should transition to PAUSE when PAUSE conditions met", () => {
      const nowMs = Date.now();
      const input: DecideInput = {
        nowMs,
        state: {
          mode: "DEFENSIVE",
          modeSinceMs: nowMs - 5000,
          pauseUntilMs: undefined,
          lastQuoteMs: nowMs - 1000,
        },
        features: { ...createDefaultFeatures(), dataStale: true },
        params: createDefaultParams(),
        position: createDefaultPosition(),
      };

      const result = decide(input);

      expect(result.nextState.mode).toBe("PAUSE");
      expect(result.intents[0].type).toBe("CANCEL_ALL");
    });
  });

  describe("state transitions", () => {
    test("should update modeSinceMs when mode changes", () => {
      const nowMs = Date.now();
      const input: DecideInput = {
        nowMs,
        state: createNormalState(nowMs),
        features: { ...createDefaultFeatures(), dataStale: true },
        params: createDefaultParams(),
        position: createDefaultPosition(),
      };

      const result = decide(input);

      expect(result.nextState.modeSinceMs).toBe(nowMs);
    });

    test("should set pauseUntilMs when entering PAUSE", () => {
      const nowMs = Date.now();
      const input: DecideInput = {
        nowMs,
        state: createNormalState(nowMs),
        features: { ...createDefaultFeatures(), dataStale: true },
        params: createDefaultParams(),
        position: createDefaultPosition(),
      };

      const result = decide(input);

      expect(result.nextState.pauseUntilMs).toBe(nowMs + PAUSE_MIN_DURATION_MS);
    });
  });
});

describe("createInitialState", () => {
  test("should create state in PAUSE mode by default", () => {
    const nowMs = Date.now();
    const state = createInitialState(nowMs);

    expect(state.mode).toBe("PAUSE");
    expect(state.modeSinceMs).toBe(nowMs);
    expect(state.pauseUntilMs).toBe(nowMs + PAUSE_MIN_DURATION_MS);
  });

  test("should allow creating state with specified mode", () => {
    const nowMs = Date.now();
    const state = createInitialState(nowMs, "NORMAL");

    expect(state.mode).toBe("NORMAL");
    expect(state.pauseUntilMs).toBeUndefined();
  });
});
