/**
 * ParamGate Unit Tests
 *
 * Requirements: 10.2, 10.5
 * - Maximum 2 parameter changes (object format: { paramName: value })
 * - Each change within ±10% of current value
 * - Rollback conditions required (structured object with at least one condition)
 */

import { describe, expect, it } from "bun:test";

import type { CurrentParamsSummary } from "@agentic-mm-bot/repositories";

import { validateProposal } from "../src/services/param-gate";
import type { ProposalOutput } from "../src/types/schemas";

const createMockParams = (): CurrentParamsSummary => ({
  paramsSetId: "test-params-id",
  baseHalfSpreadBps: "1.5",
  volSpreadGain: "0.5",
  toxSpreadGain: "0.3",
  quoteSizeUsd: "10",
  refreshIntervalMs: 1000,
  staleCancelMs: 5000,
  maxInventory: "10.0",
  inventorySkewGain: "0.2",
  pauseMarkIndexBps: "50",
  pauseLiqCount10s: 5,
});

describe("validateProposal", () => {
  describe("maximum 2 changes rule", () => {
    it("should pass with 1 change", () => {
      const proposal: ProposalOutput = {
        changes: { baseHalfSpreadBps: "1.6" },
        rollbackConditions: { markout10sP50BelowBps: -10 },
        reasoningTrace: ["Increased spread due to volatility"],
      };

      const result = validateProposal(proposal, createMockParams());
      expect(result.isOk()).toBe(true);
    });

    it("should pass with 2 changes", () => {
      const proposal: ProposalOutput = {
        changes: {
          baseHalfSpreadBps: "1.6",
          volSpreadGain: "0.52",
        },
        rollbackConditions: { markout10sP50BelowBps: -10 },
        reasoningTrace: ["Adjusted for market conditions"],
      };

      const result = validateProposal(proposal, createMockParams());
      expect(result.isOk()).toBe(true);
    });

    it("should reject with 3+ changes", () => {
      // Force 3 changes by using type assertion
      const proposal = {
        changes: {
          baseHalfSpreadBps: "1.6",
          volSpreadGain: "0.52",
          toxSpreadGain: "0.31",
        },
        rollbackConditions: { markout10sP50BelowBps: -10 },
        reasoningTrace: ["Too many changes"],
      };

      const result = validateProposal(proposal, createMockParams());
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        // Either TOO_MANY_CHANGES or INVALID_PROPOSAL_SHAPE (from Zod refine)
        expect(["TOO_MANY_CHANGES", "INVALID_PROPOSAL_SHAPE"]).toContain(result.error.type);
      }
    });
  });

  describe("±10% change limit", () => {
    it("should pass with exactly 10% increase", () => {
      const proposal: ProposalOutput = {
        changes: { baseHalfSpreadBps: "1.65" }, // +10%
        rollbackConditions: { markout10sP50BelowBps: -10 },
        reasoningTrace: ["Widened spread by 10%"],
      };

      const result = validateProposal(proposal, createMockParams());
      expect(result.isOk()).toBe(true);
    });

    it("should pass with exactly 10% decrease", () => {
      const proposal: ProposalOutput = {
        changes: { baseHalfSpreadBps: "1.35" }, // -10%
        rollbackConditions: { pauseCountAbove: 50 },
        reasoningTrace: ["Narrowed spread by 10%"],
      };

      const result = validateProposal(proposal, createMockParams());
      expect(result.isOk()).toBe(true);
    });

    it("should reject with >10% increase", () => {
      const proposal: ProposalOutput = {
        changes: { baseHalfSpreadBps: "1.70" }, // +13.3%
        rollbackConditions: { markout10sP50BelowBps: -10 },
        reasoningTrace: ["Tried to widen spread too much"],
      };

      const result = validateProposal(proposal, createMockParams());
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("CHANGE_EXCEEDS_10PCT");
      }
    });

    it("should reject with >10% decrease", () => {
      const proposal: ProposalOutput = {
        changes: { baseHalfSpreadBps: "1.30" }, // -13.3%
        rollbackConditions: { pauseCountAbove: 50 },
        reasoningTrace: ["Tried to narrow spread too much"],
      };

      const result = validateProposal(proposal, createMockParams());
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("CHANGE_EXCEEDS_10PCT");
      }
    });

    it("should work with integer parameters (refreshIntervalMs)", () => {
      const proposal: ProposalOutput = {
        changes: { refreshIntervalMs: 1100 }, // +10%
        rollbackConditions: { maxDurationMs: 3600000 },
        reasoningTrace: ["Slowed refresh rate slightly"],
      };

      const result = validateProposal(proposal, createMockParams());
      expect(result.isOk()).toBe(true);
    });

    it("should reject integer parameter exceeding 10%", () => {
      const proposal: ProposalOutput = {
        changes: { refreshIntervalMs: 1200 }, // +20%
        rollbackConditions: { maxDurationMs: 3600000 },
        reasoningTrace: ["Tried to slow refresh too much"],
      };

      const result = validateProposal(proposal, createMockParams());
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("CHANGE_EXCEEDS_10PCT");
      }
    });
  });

  describe("rollback conditions required", () => {
    it("should reject when no rollback conditions set", () => {
      // All conditions are undefined
      const proposal = {
        changes: { baseHalfSpreadBps: "1.6" },
        rollbackConditions: {},
        reasoningTrace: ["Missing rollback conditions"],
      };

      const result = validateProposal(proposal, createMockParams());
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        // Should fail at Zod validation (refine) or MISSING_ROLLBACK_CONDITIONS
        expect(["INVALID_PROPOSAL_SHAPE", "MISSING_ROLLBACK_CONDITIONS"]).toContain(result.error.type);
      }
    });

    it("should pass with markout10sP50BelowBps condition", () => {
      const proposal: ProposalOutput = {
        changes: { baseHalfSpreadBps: "1.6" },
        rollbackConditions: { markout10sP50BelowBps: -5 },
        reasoningTrace: ["Has markout rollback condition"],
      };

      const result = validateProposal(proposal, createMockParams());
      expect(result.isOk()).toBe(true);
    });

    it("should pass with pauseCountAbove condition", () => {
      const proposal: ProposalOutput = {
        changes: { baseHalfSpreadBps: "1.6" },
        rollbackConditions: { pauseCountAbove: 20 },
        reasoningTrace: ["Has pause count rollback condition"],
      };

      const result = validateProposal(proposal, createMockParams());
      expect(result.isOk()).toBe(true);
    });

    it("should pass with maxDurationMs condition", () => {
      const proposal: ProposalOutput = {
        changes: { baseHalfSpreadBps: "1.6" },
        rollbackConditions: { maxDurationMs: 3600000 },
        reasoningTrace: ["Has duration rollback condition"],
      };

      const result = validateProposal(proposal, createMockParams());
      expect(result.isOk()).toBe(true);
    });

    it("should pass with multiple rollback conditions", () => {
      const proposal: ProposalOutput = {
        changes: { baseHalfSpreadBps: "1.6" },
        rollbackConditions: {
          markout10sP50BelowBps: -10,
          pauseCountAbove: 30,
          maxDurationMs: 7200000,
        },
        reasoningTrace: ["Has multiple rollback conditions"],
      };

      const result = validateProposal(proposal, createMockParams());
      expect(result.isOk()).toBe(true);
    });
  });

  describe("invalid values", () => {
    it("should reject non-numeric string value", () => {
      const proposal = {
        changes: { baseHalfSpreadBps: "invalid" },
        rollbackConditions: { markout10sP50BelowBps: -10 },
        reasoningTrace: ["Invalid value"],
      };

      const result = validateProposal(proposal, createMockParams());
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("INVALID_PARAM_VALUE");
      }
    });
  });
});
