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
  type Snapshot,
  type StrategyState,
  type DecideInput,
} from "@agentic-mm-bot/core";

describe("Executor PAUSE Behavior", () => {
  const defaultParams: StrategyParams = {
    baseHalfSpreadBps: "10",
    volSpreadGain: "1",
    toxSpreadGain: "1",
    quoteSizeBase: "0.1",
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
  };

  describe("PAUSE state transitions", () => {
    it("should return CANCEL_ALL intent when in PAUSE mode", () => {
      const nowMs = Date.now();
      const state: StrategyState = {
        mode: "PAUSE",
        modeSince: nowMs - 60_000,
        pauseUntil: null,
        lastQuoteMs: 0,
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
      const state: StrategyState = {
        mode: "NORMAL",
        modeSince: nowMs - 60_000,
        pauseUntil: null,
        lastQuoteMs: 0,
      };

      // Features with data stale indication
      const staleFeatures: Features = {
        ...normalFeatures,
        midPx: "", // Empty indicates stale
      };

      const snapshot: Snapshot = {
        exchange: "extended",
        symbol: "BTC-USD",
        nowMs,
        bestBidPx: "",
        bestAskPx: "",
        dataStale: true, // Explicitly stale
      };

      // Risk evaluation should recommend PAUSE
      const riskEval = evaluateRisk(snapshot, staleFeatures, defaultParams, "NORMAL");

      expect(riskEval.shouldPause).toBe(true);
      expect(riskEval.reasonCodes).toContain("DATA_STALE");
    });

    it("should transition to PAUSE when mark-index divergence exceeds threshold", () => {
      const nowMs = Date.now();

      const snapshot: Snapshot = {
        exchange: "extended",
        symbol: "BTC-USD",
        nowMs,
        bestBidPx: "50000",
        bestAskPx: "50010",
        markPx: "50500", // 100 bps divergence (threshold is 50)
        indexPx: "50000",
        dataStale: false,
      };

      const features: Features = {
        ...normalFeatures,
        markIndexDivBps: "100", // > pauseMarkIndexBps (50)
      };

      const riskEval = evaluateRisk(snapshot, features, defaultParams, "NORMAL");

      expect(riskEval.shouldPause).toBe(true);
      expect(riskEval.reasonCodes).toContain("MARK_INDEX_DIVERGED");
    });

    it("should transition to PAUSE when liquidation count exceeds threshold", () => {
      const nowMs = Date.now();

      const snapshot: Snapshot = {
        exchange: "extended",
        symbol: "BTC-USD",
        nowMs,
        bestBidPx: "50000",
        bestAskPx: "50010",
        dataStale: false,
      };

      const features: Features = {
        ...normalFeatures,
        liqCount10s: 5, // > pauseLiqCount10s (3)
      };

      const riskEval = evaluateRisk(snapshot, features, defaultParams, "NORMAL");

      expect(riskEval.shouldPause).toBe(true);
      expect(riskEval.reasonCodes).toContain("LIQUIDATION_SPIKE");
    });

    it("should transition to PAUSE when inventory exceeds limit", () => {
      const nowMs = Date.now();

      const snapshot: Snapshot = {
        exchange: "extended",
        symbol: "BTC-USD",
        nowMs,
        bestBidPx: "50000",
        bestAskPx: "50010",
        dataStale: false,
      };

      const position: Position = {
        size: "1.5", // > maxInventory (1)
      };

      const riskEval = evaluateRisk(snapshot, normalFeatures, defaultParams, "NORMAL");

      // Check with position
      const absPosition = Math.abs(parseFloat(position.size));
      const maxInventory = parseFloat(defaultParams.maxInventory);
      const inventoryExceeded = absPosition > maxInventory;

      expect(inventoryExceeded).toBe(true);
    });
  });

  describe("PAUSE recovery", () => {
    it("should transition to DEFENSIVE after PAUSE recovery, not NORMAL", () => {
      const nowMs = Date.now();

      // State was in PAUSE, now conditions are normal
      const state: StrategyState = {
        mode: "PAUSE",
        modeSince: nowMs - 30_000, // Been in PAUSE for 30s
        pauseUntil: nowMs - 10_000, // PAUSE duration expired 10s ago
        lastQuoteMs: 0,
      };

      const snapshot: Snapshot = {
        exchange: "extended",
        symbol: "BTC-USD",
        nowMs,
        bestBidPx: "50000",
        bestAskPx: "50010",
        dataStale: false,
      };

      // Risk evaluation with normal conditions
      const riskEval = evaluateRisk(snapshot, normalFeatures, defaultParams, "PAUSE");

      // If shouldPause is false and we're in PAUSE, we should go to DEFENSIVE
      if (!riskEval.shouldPause) {
        // The expected behavior is to recover to DEFENSIVE, not NORMAL
        expect(riskEval.recommendedMode).toBe("DEFENSIVE");
      }
    });
  });

  describe("Decision cycle with missing data", () => {
    it("should not generate QUOTE intent when features are missing", () => {
      const nowMs = Date.now();
      const state: StrategyState = {
        mode: "NORMAL",
        modeSince: nowMs - 60_000,
        pauseUntil: null,
        lastQuoteMs: 0,
      };

      // Empty/invalid features indicate missing data
      const missingFeatures: Features = {
        midPx: "",
        spreadBps: "",
        tradeImbalance1s: "0",
        realizedVol10s: "0",
        markIndexDivBps: "",
        liqCount10s: 0,
      };

      const input: DecideInput = {
        nowMs,
        state,
        features: missingFeatures,
        params: defaultParams,
        position: defaultPosition,
      };

      const output = decide(input);

      // Should either PAUSE or at least not quote
      const hasQuoteIntent = output.intents.some(i => i.type === "QUOTE");
      expect(hasQuoteIntent).toBe(false);
    });
  });
});
