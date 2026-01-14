/**
 * Executor Integration Tests - PAUSE behavior
 *
 * Requirements: 4.5, 5.2, 6.6, 7.5, 14.3.2
 * - Verify PAUSE triggers cancel_all
 * - Verify data stale triggers PAUSE
 * - Verify executor does not quote when data is missing
 */

import { describe, it, expect } from "bun:test";
import {
  decide,
  createInitialState,
  evaluateRisk,
  type StrategyParams,
  type Features,
  type Position,
  type StrategyState,
  type DecideInput,
} from "@agentic-mm-bot/core";

describe("Executor PAUSE Behavior", () => {
  const defaultParams: StrategyParams = {
    baseHalfSpreadBps: "10",
    volSpreadGain: "1",
    toxSpreadGain: "1",
    quoteSizeUsd: "10",
    refreshIntervalMs: 1000,
    staleCancelMs: 5000,
    maxInventory: "1",
    inventorySkewGain: "5",
    pauseMarkIndexBps: "50",
    pauseLiqCount10s: 3,
  };

  const defaultPosition: Position = {
    size: "0",
  };

  const normalFeatures: Features = {
    midPx: "50000",
    spreadBps: "5",
    tradeImbalance1s: "0.1",
    realizedVol10s: "0.001",
    markIndexDivBps: "10",
    liqCount10s: 0,
    dataStale: false,
  };

  describe("PAUSE state transitions", () => {
    it("should return CANCEL_ALL intent when in PAUSE mode", () => {
      const nowMs = Date.now();
      const state: StrategyState = {
        mode: "PAUSE",
        modeSinceMs: nowMs - 60_000,
        pauseUntilMs: nowMs + 10_000, // keep PAUSE
        lastQuoteMs: undefined,
      };

      const input: DecideInput = {
        nowMs,
        state,
        features: normalFeatures,
        params: defaultParams,
        position: defaultPosition,
      };

      const output = decide(input);

      expect(output.nextState.mode).toBe("PAUSE");
      expect(output.intents).toHaveLength(1);
      expect(output.intents[0].type).toBe("CANCEL_ALL");
    });

    it("should transition to PAUSE when data is stale", () => {
      const nowMs = Date.now();
      const state = createInitialState(nowMs, "NORMAL");

      const staleFeatures: Features = {
        ...normalFeatures,
        dataStale: true,
      };

      const riskEval = evaluateRisk(staleFeatures, defaultPosition, defaultParams);
      expect(riskEval.shouldPause).toBe(true);
      expect(riskEval.reasonCodes).toContain("DATA_STALE");

      const output = decide({
        nowMs,
        state,
        features: staleFeatures,
        params: defaultParams,
        position: defaultPosition,
      });
      expect(output.nextState.mode).toBe("PAUSE");
      expect(output.intents[0]?.type).toBe("CANCEL_ALL");
    });

    it("should transition to PAUSE when mark-index divergence exceeds threshold", () => {
      const nowMs = Date.now();

      const features: Features = {
        ...normalFeatures,
        markIndexDivBps: "100", // > pauseMarkIndexBps (50)
      };

      const riskEval = evaluateRisk(features, defaultPosition, defaultParams);

      expect(riskEval.shouldPause).toBe(true);
      expect(riskEval.reasonCodes).toContain("MARK_INDEX_DIVERGED");
    });

    it("should transition to PAUSE when liquidation count exceeds threshold", () => {
      const nowMs = Date.now();

      const features: Features = {
        ...normalFeatures,
        liqCount10s: 5, // > pauseLiqCount10s (3)
      };

      const riskEval = evaluateRisk(features, defaultPosition, defaultParams);

      expect(riskEval.shouldPause).toBe(true);
      expect(riskEval.reasonCodes).toContain("LIQUIDATION_SPIKE");
    });

    it("should transition to PAUSE when inventory exceeds limit", () => {
      const nowMs = Date.now();

      const position: Position = {
        size: "1.5", // > maxInventory (1)
      };

      const riskEval = evaluateRisk(normalFeatures, position, defaultParams);
      expect(riskEval.shouldPause).toBe(true);
      expect(riskEval.reasonCodes).toContain("INVENTORY_LIMIT");
    });
  });

  describe("PAUSE recovery", () => {
    it("should transition to DEFENSIVE after PAUSE recovery, not NORMAL", () => {
      const nowMs = Date.now();

      // State was in PAUSE, now conditions are normal
      const state: StrategyState = {
        mode: "PAUSE",
        modeSinceMs: nowMs - 30_000, // Been in PAUSE for 30s
        pauseUntilMs: nowMs - 10_000, // PAUSE duration expired 10s ago
        lastQuoteMs: undefined,
      };

      const output = decide({
        nowMs,
        state,
        features: normalFeatures,
        params: defaultParams,
        position: defaultPosition,
      });

      expect(output.nextState.mode).toBe("DEFENSIVE");
      expect(output.intents[0]?.type).toBe("QUOTE");
    });
  });

  describe("Decision cycle with missing data", () => {
    it("should not generate QUOTE intent when features are missing", () => {
      const nowMs = Date.now();
      const state = createInitialState(nowMs, "NORMAL");

      // Missing data should be represented as dataStale
      const missingFeatures: Features = {
        ...normalFeatures,
        dataStale: true,
      };

      const input: DecideInput = {
        nowMs,
        state,
        features: missingFeatures,
        params: defaultParams,
        position: defaultPosition,
      };

      const output = decide(input);

      expect(output.nextState.mode).toBe("PAUSE");
      expect(output.intents[0]?.type).toBe("CANCEL_ALL");
    });
  });
});
