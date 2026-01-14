/**
 * ParamGate Unit Tests
 *
 * Requirements: 10.2, 10.5
 * - Schema validation
 * - Constraint validation (max 2 params, ±10%)
 * - Rollback conditions required
 */

import { describe, expect, test } from "bun:test";

import {
  validateProposal,
  isWithinChangeLimit,
  isWithinPercentageRange,
  type ParamProposal,
  type ParamGateResult,
  ALLOWED_PARAM_KEYS,
} from "../src/param-gate";
import type { StrategyParams } from "../src/types";

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const baseParams: StrategyParams = {
  baseHalfSpreadBps: "10",
  volSpreadGain: "0.5",
  toxSpreadGain: "0.3",
  quoteSizeUsd: "10",
  refreshIntervalMs: 1000,
  staleCancelMs: 5000,
  maxInventory: "1.0",
  inventorySkewGain: "0.1",
  pauseMarkIndexBps: "100",
  pauseLiqCount10s: 5,
};

// ─────────────────────────────────────────────────────────────────────────────
// isWithinPercentageRange Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("isWithinPercentageRange", () => {
  test("should return true for 0% change", () => {
    expect(isWithinPercentageRange(100, 100, 10)).toBe(true);
  });

  test("should return true for exactly +10% change", () => {
    expect(isWithinPercentageRange(100, 110, 10)).toBe(true);
  });

  test("should return true for exactly -10% change", () => {
    expect(isWithinPercentageRange(100, 90, 10)).toBe(true);
  });

  test("should return false for +11% change", () => {
    expect(isWithinPercentageRange(100, 111, 10)).toBe(false);
  });

  test("should return false for -11% change", () => {
    expect(isWithinPercentageRange(100, 89, 10)).toBe(false);
  });

  test("should handle string values", () => {
    expect(isWithinPercentageRange("10", "11", 10)).toBe(true);
    expect(isWithinPercentageRange("10", "12", 10)).toBe(false);
  });

  test("should handle edge case: zero original value", () => {
    // When original is 0, any change is considered out of range
    expect(isWithinPercentageRange(0, 1, 10)).toBe(false);
    expect(isWithinPercentageRange(0, 0, 10)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isWithinChangeLimit Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("isWithinChangeLimit", () => {
  test("should return true for 0 changes", () => {
    expect(isWithinChangeLimit({}, 2)).toBe(true);
  });

  test("should return true for 1 change", () => {
    expect(isWithinChangeLimit({ baseHalfSpreadBps: "11" }, 2)).toBe(true);
  });

  test("should return true for exactly 2 changes", () => {
    const changes = { baseHalfSpreadBps: "11", volSpreadGain: "0.55" };
    expect(isWithinChangeLimit(changes, 2)).toBe(true);
  });

  test("should return false for 3 changes", () => {
    const changes = {
      baseHalfSpreadBps: "11",
      volSpreadGain: "0.55",
      toxSpreadGain: "0.33",
    };
    expect(isWithinChangeLimit(changes, 2)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateProposal Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("validateProposal", () => {
  test("should accept valid proposal with 1 change within 10%", () => {
    const proposal: ParamProposal = {
      changes: { baseHalfSpreadBps: "11" }, // +10%
      rollbackConditions: { markout10sP50BelowBps: -5 },
    };

    const result = validateProposal(proposal, baseParams);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("should accept valid proposal with 2 changes within 10%", () => {
    const proposal: ParamProposal = {
      changes: {
        baseHalfSpreadBps: "11", // +10%
        volSpreadGain: "0.55", // +10%
      },
      rollbackConditions: { markout10sP50BelowBps: -5 },
    };

    const result = validateProposal(proposal, baseParams);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("should reject proposal with more than 2 changes", () => {
    const proposal: ParamProposal = {
      changes: {
        baseHalfSpreadBps: "11",
        volSpreadGain: "0.55",
        toxSpreadGain: "0.33",
      },
      rollbackConditions: { markout10sP50BelowBps: -5 },
    };

    const result = validateProposal(proposal, baseParams);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("CHANGE_LIMIT_EXCEEDED");
  });

  test("should reject proposal with change exceeding +10%", () => {
    const proposal: ParamProposal = {
      changes: { baseHalfSpreadBps: "12" }, // +20%
      rollbackConditions: { markout10sP50BelowBps: -5 },
    };

    const result = validateProposal(proposal, baseParams);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("PERCENTAGE_EXCEEDED:baseHalfSpreadBps");
  });

  test("should reject proposal with change exceeding -10%", () => {
    const proposal: ParamProposal = {
      changes: { baseHalfSpreadBps: "8" }, // -20%
      rollbackConditions: { markout10sP50BelowBps: -5 },
    };

    const result = validateProposal(proposal, baseParams);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("PERCENTAGE_EXCEEDED:baseHalfSpreadBps");
  });

  test("should reject proposal without rollback conditions", () => {
    const proposal: ParamProposal = {
      changes: { baseHalfSpreadBps: "11" },
      rollbackConditions: {},
    };

    const result = validateProposal(proposal, baseParams);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("ROLLBACK_CONDITIONS_REQUIRED");
  });

  test("should reject proposal with invalid param key", () => {
    const proposal: ParamProposal = {
      changes: { invalidParam: "100" } as Record<string, string>,
      rollbackConditions: { markout10sP50BelowBps: -5 },
    };

    const result = validateProposal(proposal, baseParams);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("INVALID_PARAM_KEY:invalidParam");
  });

  test("should handle empty changes (valid but pointless)", () => {
    const proposal: ParamProposal = {
      changes: {},
      rollbackConditions: { markout10sP50BelowBps: -5 },
    };

    const result = validateProposal(proposal, baseParams);

    expect(result.valid).toBe(true);
  });

  test("should handle integer params correctly", () => {
    const proposal: ParamProposal = {
      changes: { refreshIntervalMs: 1100 }, // +10%
      rollbackConditions: { markout10sP50BelowBps: -5 },
    };

    const result = validateProposal(proposal, baseParams);

    expect(result.valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ALLOWED_PARAM_KEYS Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("ALLOWED_PARAM_KEYS", () => {
  test("should contain all strategy param keys", () => {
    expect(ALLOWED_PARAM_KEYS).toContain("baseHalfSpreadBps");
    expect(ALLOWED_PARAM_KEYS).toContain("volSpreadGain");
    expect(ALLOWED_PARAM_KEYS).toContain("toxSpreadGain");
    expect(ALLOWED_PARAM_KEYS).toContain("quoteSizeUsd");
    expect(ALLOWED_PARAM_KEYS).toContain("refreshIntervalMs");
    expect(ALLOWED_PARAM_KEYS).toContain("staleCancelMs");
    expect(ALLOWED_PARAM_KEYS).toContain("maxInventory");
    expect(ALLOWED_PARAM_KEYS).toContain("inventorySkewGain");
    expect(ALLOWED_PARAM_KEYS).toContain("pauseMarkIndexBps");
    expect(ALLOWED_PARAM_KEYS).toContain("pauseLiqCount10s");
  });

  test("should have exactly 10 keys", () => {
    expect(ALLOWED_PARAM_KEYS.length).toBe(10);
  });
});
