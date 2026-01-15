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
  isWithinReasonableRange,
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
// isWithinReasonableRange Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("isWithinReasonableRange", () => {
  test("should return true for 0% change", () => {
    expect(isWithinReasonableRange("baseHalfSpreadBps", 100, 100)).toBe(true);
  });

  test("should return true for exactly +10% change", () => {
    expect(isWithinReasonableRange("baseHalfSpreadBps", 100, 110)).toBe(true);
  });

  test("should return true for exactly -10% change", () => {
    expect(isWithinReasonableRange("baseHalfSpreadBps", 100, 90)).toBe(true);
  });

  test("should return false for extreme increase beyond maxRatio", () => {
    expect(isWithinReasonableRange("baseHalfSpreadBps", 100, 400)).toBe(false); // 4x > 3x
  });

  test("should return false for extreme decrease beyond minRatio", () => {
    expect(isWithinReasonableRange("baseHalfSpreadBps", 100, 20)).toBe(false); // 0.2x < 0.3x
  });

  test("should handle string values", () => {
    expect(isWithinReasonableRange("baseHalfSpreadBps", "10", "11")).toBe(true);
    expect(isWithinReasonableRange("baseHalfSpreadBps", "10", "1000")).toBe(false);
  });

  test("should handle edge case: zero original value", () => {
    // When original is 0, ratio can't be computed; we only enforce finiteness/absMax/sign.
    expect(isWithinReasonableRange("baseHalfSpreadBps", 0, 1)).toBe(true);
    expect(isWithinReasonableRange("baseHalfSpreadBps", 0, 0)).toBe(true);
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
  test("should accept valid proposal with 1 change (small tweak)", () => {
    const proposal: ParamProposal = {
      changes: { baseHalfSpreadBps: "11" }, // +10%
      rollbackConditions: { markout10sP50BelowBps: -5 },
    };

    const result = validateProposal(proposal, baseParams);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("should accept valid proposal with 2 changes (small tweaks)", () => {
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

  test("should reject proposal with excessive increase", () => {
    const proposal: ParamProposal = {
      changes: { baseHalfSpreadBps: "1000" }, // extreme vs 10
      rollbackConditions: { markout10sP50BelowBps: -5 },
    };

    const result = validateProposal(proposal, baseParams);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("EXCESSIVE_CHANGE:baseHalfSpreadBps");
  });

  test("should reject proposal with negative value (not allowed)", () => {
    const proposal: ParamProposal = {
      changes: { baseHalfSpreadBps: "-1" },
      rollbackConditions: { markout10sP50BelowBps: -5 },
    };

    const result = validateProposal(proposal, baseParams);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("EXCESSIVE_CHANGE:baseHalfSpreadBps");
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
