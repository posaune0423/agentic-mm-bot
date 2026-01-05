/**
 * ParamGate Unit Tests
 *
 * Requirements: 10.2, 10.5
 * - Maximum 2 parameter changes
 * - Each change within ±10% of current value
 * - Rollback conditions required
 */

import { describe, expect, it } from "bun:test";

import type { CurrentParamsSummary } from "@agentic-mm-bot/repositories";

import { validateProposal, type ParamGateError } from "../src/services/param-gate";
import type { ProposalOutput } from "../src/types/schemas";

const createMockParams = (): CurrentParamsSummary => ({
  paramsSetId: "test-params-id",
  baseHalfSpreadBps: "1.5",
  volSpreadGain: "0.5",
  toxSpreadGain: "0.3",
  quoteSizeBase: "0.1",
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
        changes: [{ param: "baseHalfSpreadBps", fromValue: "1.5", toValue: "1.6" }],
        rollbackConditions: ["revert if markout < -10bps"],
        reasoningTrace: ["Increased spread due to volatility"],
      };

      const result = validateProposal(proposal, createMockParams());
      expect(result.isOk()).toBe(true);
    });

    it("should pass with 2 changes", () => {
      const proposal: ProposalOutput = {
        changes: [
          { param: "baseHalfSpreadBps", fromValue: "1.5", toValue: "1.6" },
          { param: "volSpreadGain", fromValue: "0.5", toValue: "0.52" },
        ],
        rollbackConditions: ["revert if markout < -10bps"],
        reasoningTrace: ["Adjusted for market conditions"],
      };

      const result = validateProposal(proposal, createMockParams());
      expect(result.isOk()).toBe(true);
    });

    it("should reject with 3+ changes", () => {
      const proposal: ProposalOutput = {
        changes: [
          { param: "baseHalfSpreadBps", fromValue: "1.5", toValue: "1.6" },
          { param: "volSpreadGain", fromValue: "0.5", toValue: "0.52" },
          { param: "toxSpreadGain", fromValue: "0.3", toValue: "0.31" },
        ] as any, // Force 3 changes to bypass Zod max(2)
        rollbackConditions: ["revert if markout < -10bps"],
        reasoningTrace: ["Too many changes"],
      };

      const result = validateProposal(proposal, createMockParams());
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("TOO_MANY_CHANGES");
        expect((result.error as { type: "TOO_MANY_CHANGES"; count: number }).count).toBe(3);
      }
    });
  });

  describe("±10% change limit", () => {
    it("should pass with exactly 10% increase", () => {
      const proposal: ProposalOutput = {
        changes: [{ param: "baseHalfSpreadBps", fromValue: "1.5", toValue: "1.65" }], // +10%
        rollbackConditions: ["revert if markout < -10bps"],
        reasoningTrace: ["Widened spread by 10%"],
      };

      const result = validateProposal(proposal, createMockParams());
      expect(result.isOk()).toBe(true);
    });

    it("should pass with exactly 10% decrease", () => {
      const proposal: ProposalOutput = {
        changes: [{ param: "baseHalfSpreadBps", fromValue: "1.5", toValue: "1.35" }], // -10%
        rollbackConditions: ["revert if fills too low"],
        reasoningTrace: ["Narrowed spread by 10%"],
      };

      const result = validateProposal(proposal, createMockParams());
      expect(result.isOk()).toBe(true);
    });

    it("should reject with >10% increase", () => {
      const proposal: ProposalOutput = {
        changes: [{ param: "baseHalfSpreadBps", fromValue: "1.5", toValue: "1.70" }], // +13.3%
        rollbackConditions: ["revert if markout < -10bps"],
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
        changes: [{ param: "baseHalfSpreadBps", fromValue: "1.5", toValue: "1.30" }], // -13.3%
        rollbackConditions: ["revert if fills too low"],
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
        changes: [{ param: "refreshIntervalMs", fromValue: "1000", toValue: "1100" }], // +10%
        rollbackConditions: ["revert if latency increases"],
        reasoningTrace: ["Slowed refresh rate slightly"],
      };

      const result = validateProposal(proposal, createMockParams());
      expect(result.isOk()).toBe(true);
    });

    it("should reject integer parameter exceeding 10%", () => {
      const proposal: ProposalOutput = {
        changes: [{ param: "refreshIntervalMs", fromValue: "1000", toValue: "1200" }], // +20%
        rollbackConditions: ["revert if latency increases"],
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
    it("should reject when no rollback conditions", () => {
      const proposal: ProposalOutput = {
        changes: [{ param: "baseHalfSpreadBps", fromValue: "1.5", toValue: "1.6" }],
        rollbackConditions: [],
        reasoningTrace: ["Missing rollback conditions"],
      };

      const result = validateProposal(proposal, createMockParams());
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("MISSING_ROLLBACK_CONDITIONS");
      }
    });

    it("should pass with at least one rollback condition", () => {
      const proposal: ProposalOutput = {
        changes: [{ param: "baseHalfSpreadBps", fromValue: "1.5", toValue: "1.6" }],
        rollbackConditions: ["revert after 1 hour if markout < -5bps"],
        reasoningTrace: ["Has rollback condition"],
      };

      const result = validateProposal(proposal, createMockParams());
      expect(result.isOk()).toBe(true);
    });
  });

  describe("invalid values", () => {
    it("should reject non-numeric value", () => {
      const proposal: ProposalOutput = {
        changes: [{ param: "baseHalfSpreadBps", fromValue: "1.5", toValue: "invalid" }],
        rollbackConditions: ["revert if issues"],
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
