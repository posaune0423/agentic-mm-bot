/**
 * Params Overlay Unit Tests
 */

import { describe, it, expect, beforeEach } from "bun:test";

import {
  ParamsOverlayManager,
  computeParamsSignature,
  DEFAULT_OVERLAY_CONFIG,
} from "../../src/services/params-overlay";
import type { StrategyParams } from "@agentic-mm-bot/core";

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const createParams = (baseHalfSpreadBps = "10"): StrategyParams => ({
  baseHalfSpreadBps,
  volSpreadGain: "1",
  toxSpreadGain: "1",
  quoteSizeUsd: "10",
  refreshIntervalMs: 1000,
  staleCancelMs: 5000,
  maxInventory: "1",
  inventorySkewGain: "5",
  pauseMarkIndexBps: "50",
  pauseLiqCount10s: 3,
});

// ─────────────────────────────────────────────────────────────────────────────
// computeParamsSignature Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("computeParamsSignature", () => {
  it("should generate consistent signature for same params", () => {
    const params = createParams();
    const sig1 = computeParamsSignature(params);
    const sig2 = computeParamsSignature(params);
    expect(sig1).toBe(sig2);
  });

  it("should generate different signature when params change", () => {
    const params1 = createParams("10");
    const params2 = createParams("11");
    expect(computeParamsSignature(params1)).not.toBe(computeParamsSignature(params2));
  });

  it("should include all 10 params in signature", () => {
    const params = createParams();
    const sig = computeParamsSignature(params);
    // Should have 9 pipes (10 values)
    expect(sig.split("|").length).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ParamsOverlayManager Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("ParamsOverlayManager", () => {
  let manager: ParamsOverlayManager;

  beforeEach(() => {
    manager = new ParamsOverlayManager({
      noFillWindowMs: 1000, // 1 second for testing
      tightenStepBps: 1,
      minBaseHalfSpreadBps: 5,
      tightenIntervalMs: 500, // 0.5 second for testing
    });
  });

  describe("initial state", () => {
    it("should start with zero tightening", () => {
      const state = manager.getState();
      expect(state.tightenBps).toBe(0);
      expect(state.active).toBe(true);
    });

    it("should return db params unchanged initially", () => {
      const params = createParams("10");
      const nowMs = Date.now();
      const effective = manager.computeEffectiveParams(params, nowMs);
      expect(effective.baseHalfSpreadBps).toBe("10");
    });

    it("should never widen baseHalfSpreadBps above DB value (even if floor > db)", () => {
      // floor is 5 (see beforeEach), db is 4.5 -> effective must stay 4.5 (no widening)
      const params = createParams("4.5");
      const nowMs = Date.now();
      const effective = manager.computeEffectiveParams(params, nowMs);
      expect(effective.baseHalfSpreadBps).toBe("4.5");
      expect(manager.getState().tightenBps).toBe(0);
    });
  });

  describe("onFill", () => {
    it("should reset tightening on fill", () => {
      const params = createParams("10");
      const nowMs = Date.now();

      // First fill sets lastFillAtMs
      manager.onFill(nowMs);

      // Wait for tightening
      manager.computeEffectiveParams(params, nowMs + 2000);
      expect(manager.getState().tightenBps).toBeGreaterThan(0);

      // Fill should reset
      manager.onFill(nowMs + 2000);
      expect(manager.getState().tightenBps).toBe(0);
    });

    it("should update lastFillAtMs", () => {
      const nowMs = Date.now();
      manager.onFill(nowMs);
      expect(manager.getState().lastFillAtMs).toBe(nowMs);
    });
  });

  describe("setActive", () => {
    it("should disable overlay and reset tightening", () => {
      const params = createParams("10");
      const nowMs = Date.now();

      // Initialize and trigger tightening
      manager.onFill(nowMs);
      manager.computeEffectiveParams(params, nowMs + 2000);
      expect(manager.getState().tightenBps).toBeGreaterThan(0);

      // Disable
      manager.setActive(false);
      expect(manager.getState().active).toBe(false);
      expect(manager.getState().tightenBps).toBe(0);
    });

    it("should return db params when inactive", () => {
      const params = createParams("10");
      manager.setActive(false);
      const effective = manager.computeEffectiveParams(params, Date.now());
      expect(effective.baseHalfSpreadBps).toBe("10");
    });
  });

  describe("tightening logic", () => {
    it("should not tighten before noFillWindowMs", () => {
      const params = createParams("10");
      const nowMs = Date.now();

      // First call initializes lastFillAtMs
      manager.computeEffectiveParams(params, nowMs);

      // Just before window
      const effective = manager.computeEffectiveParams(params, nowMs + 900);
      expect(effective.baseHalfSpreadBps).toBe("10");
      expect(manager.getState().tightenBps).toBe(0);
    });

    it("should tighten after noFillWindowMs", () => {
      const params = createParams("10");
      const nowMs = Date.now();

      // First call initializes lastFillAtMs
      manager.computeEffectiveParams(params, nowMs);

      // After window
      const effective = manager.computeEffectiveParams(params, nowMs + 1100);
      expect(effective.baseHalfSpreadBps).toBe("9"); // 10 - 1
      expect(manager.getState().tightenBps).toBe(1);
    });

    it("should respect tightenIntervalMs", () => {
      const params = createParams("10");
      const nowMs = Date.now();

      // Initialize
      manager.computeEffectiveParams(params, nowMs);

      // First tighten
      manager.computeEffectiveParams(params, nowMs + 1100);
      expect(manager.getState().tightenBps).toBe(1);

      // Too soon for second tighten
      manager.computeEffectiveParams(params, nowMs + 1200);
      expect(manager.getState().tightenBps).toBe(1);

      // After interval
      manager.computeEffectiveParams(params, nowMs + 1700);
      expect(manager.getState().tightenBps).toBe(2);
    });

    it("should respect minBaseHalfSpreadBps floor", () => {
      const params = createParams("6"); // Only 1 bps above floor
      const nowMs = Date.now();

      // Initialize
      manager.computeEffectiveParams(params, nowMs);

      // Tighten
      manager.computeEffectiveParams(params, nowMs + 1100);
      expect(manager.getState().tightenBps).toBe(1);

      // Should stop at floor (can't tighten further)
      manager.computeEffectiveParams(params, nowMs + 1700);
      expect(manager.getState().tightenBps).toBe(1);

      const effective = manager.computeEffectiveParams(params, nowMs + 2300);
      expect(effective.baseHalfSpreadBps).toBe("5"); // At floor
    });
  });

  describe("reset", () => {
    it("should reset all state", () => {
      const params = createParams("10");
      const nowMs = Date.now();

      // Build up some state
      manager.onFill(nowMs);
      manager.computeEffectiveParams(params, nowMs + 2000);

      // Reset
      manager.reset();

      const state = manager.getState();
      expect(state.tightenBps).toBe(0);
      expect(state.lastTightenAtMs).toBeNull();
      expect(state.lastFillAtMs).toBeNull();
      expect(state.active).toBe(true);
    });
  });
});
