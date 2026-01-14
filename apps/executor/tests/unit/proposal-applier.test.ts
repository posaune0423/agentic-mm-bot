/**
 * Proposal Applier Unit Tests
 *
 * Requirements: 10.4, 10.5, 10.6
 * - Format validation (new format only)
 * - Time boundary validation
 */

import { describe, expect, test } from "bun:test";
import { okAsync } from "neverthrow";

import { isAtFiveMinuteBoundary, isAtTimeBoundary, tryApplyProposal } from "../../src/services/proposal-applier";
import type { LlmProposal, StrategyParams } from "@agentic-mm-bot/db";
import type { ProposalRepository } from "@agentic-mm-bot/repositories";

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function createMockCurrentParams(): StrategyParams {
  return {
    id: "params-123",
    exchange: "extended",
    symbol: "BTC-USD",
    isCurrent: true,
    createdBy: "manual",
    createdAt: new Date(),
    baseHalfSpreadBps: "5.0",
    volSpreadGain: "0.5",
    toxSpreadGain: "0.3",
    quoteSizeUsd: "100",
    refreshIntervalMs: 1000,
    staleCancelMs: 5000,
    maxInventory: "1.0",
    inventorySkewGain: "0.2",
    pauseMarkIndexBps: "50",
    pauseLiqCount10s: 5,
  };
}

function createMockRepo(): ProposalRepository {
  return {
    updateProposalStatus: () => okAsync(undefined),
    saveParamRollout: () => okAsync(undefined),
    createStrategyParams: () => okAsync(createMockCurrentParams()),
    setCurrentParams: () => okAsync(undefined),
    getCurrentParams: () => okAsync(createMockCurrentParams()),
    getPendingProposals: () => okAsync([]),
  } as unknown as ProposalRepository;
}

function createMockContext() {
  return {
    pauseCountLastHour: 0,
    dataStale: false,
    dbWriteFailures: false,
    exchangeErrors: false,
  };
}

function createMockOptions() {
  return {
    exchange: "extended",
    symbol: "BTC-USD",
    maxPauseCountForApply: 100,
    minMarkout10sP50ForApply: -100,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// isAtFiveMinuteBoundary Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("isAtFiveMinuteBoundary", () => {
  test("should return true at exactly 00:00", () => {
    // 2024-01-01 00:00:00.000
    const ts = new Date("2024-01-01T00:00:00.000Z").getTime();
    expect(isAtFiveMinuteBoundary(ts)).toBe(true);
  });

  test("should return true at 00:05:00", () => {
    const ts = new Date("2024-01-01T00:05:00.000Z").getTime();
    expect(isAtFiveMinuteBoundary(ts)).toBe(true);
  });

  test("should return true at 00:10:00", () => {
    const ts = new Date("2024-01-01T00:10:00.000Z").getTime();
    expect(isAtFiveMinuteBoundary(ts)).toBe(true);
  });

  test("should return true within first 30 seconds of boundary", () => {
    const ts = new Date("2024-01-01T00:05:29.999Z").getTime();
    expect(isAtFiveMinuteBoundary(ts)).toBe(true);
  });

  test("should return false at 30 seconds past boundary", () => {
    const ts = new Date("2024-01-01T00:05:30.000Z").getTime();
    expect(isAtFiveMinuteBoundary(ts)).toBe(false);
  });

  test("should return false at 00:01:00 (not a 5-min boundary)", () => {
    const ts = new Date("2024-01-01T00:01:00.000Z").getTime();
    expect(isAtFiveMinuteBoundary(ts)).toBe(false);
  });

  test("should return false at 00:03:00 (not a 5-min boundary)", () => {
    const ts = new Date("2024-01-01T00:03:00.000Z").getTime();
    expect(isAtFiveMinuteBoundary(ts)).toBe(false);
  });

  test("should return true at 12:15:00", () => {
    const ts = new Date("2024-01-01T12:15:00.000Z").getTime();
    expect(isAtFiveMinuteBoundary(ts)).toBe(true);
  });

  test("should return true at 23:55:00", () => {
    const ts = new Date("2024-01-01T23:55:00.000Z").getTime();
    expect(isAtFiveMinuteBoundary(ts)).toBe(true);
  });
});

describe("isAtTimeBoundary", () => {
  test("should support 1-minute boundaries", () => {
    const ts = new Date("2024-01-01T00:01:00.000Z").getTime();
    expect(isAtTimeBoundary(ts, { boundaryMinutes: 1, graceSeconds: 30 })).toBe(true);
  });

  test("should return false when outside grace window", () => {
    const ts = new Date("2024-01-01T00:01:30.000Z").getTime();
    expect(isAtTimeBoundary(ts, { boundaryMinutes: 1, graceSeconds: 30 })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Format Validation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("tryApplyProposal format validation", () => {
  test("should reject old array-based proposalJson format", async () => {
    const proposal: LlmProposal = {
      id: "proposal-123",
      exchange: "extended",
      symbol: "BTC-USD",
      ts: new Date(),
      inputWindowStart: new Date(),
      inputWindowEnd: new Date(),
      currentParamsSetId: "params-123",
      // OLD FORMAT: array of changes
      proposalJson: [{ param: "baseHalfSpreadBps", fromValue: "5.0", toValue: "5.5" }],
      // OLD FORMAT: string array
      rollbackJson: ["revert if markout < -10"],
      reasoningLogPath: "/path/to/log.json",
      reasoningLogSha256: "abc123",
      status: "pending",
      decidedAt: null,
      decidedBy: null,
      rejectReason: null,
    };

    const repo = createMockRepo();
    const result = await tryApplyProposal(
      repo,
      proposal,
      createMockCurrentParams(),
      createMockContext(),
      createMockOptions(),
    );

    expect(result.isOk()).toBe(true);
    expect(result.value).toBe(null); // Rejected (returns null)
  });

  test("should reject string array rollbackJson format", async () => {
    const proposal: LlmProposal = {
      id: "proposal-124",
      exchange: "extended",
      symbol: "BTC-USD",
      ts: new Date(),
      inputWindowStart: new Date(),
      inputWindowEnd: new Date(),
      currentParamsSetId: "params-123",
      // NEW FORMAT: object
      proposalJson: { baseHalfSpreadBps: "5.5" },
      // OLD FORMAT: string array
      rollbackJson: ["revert if markout < -10"],
      reasoningLogPath: "/path/to/log.json",
      reasoningLogSha256: "abc123",
      status: "pending",
      decidedAt: null,
      decidedBy: null,
      rejectReason: null,
    };

    const repo = createMockRepo();
    const result = await tryApplyProposal(
      repo,
      proposal,
      createMockCurrentParams(),
      createMockContext(),
      createMockOptions(),
    );

    expect(result.isOk()).toBe(true);
    expect(result.value).toBe(null); // Rejected
  });

  test("should reject empty rollbackConditions object", async () => {
    const proposal: LlmProposal = {
      id: "proposal-125",
      exchange: "extended",
      symbol: "BTC-USD",
      ts: new Date(),
      inputWindowStart: new Date(),
      inputWindowEnd: new Date(),
      currentParamsSetId: "params-123",
      proposalJson: { baseHalfSpreadBps: "5.5" },
      // Empty object - no conditions set
      rollbackJson: {},
      reasoningLogPath: "/path/to/log.json",
      reasoningLogSha256: "abc123",
      status: "pending",
      decidedAt: null,
      decidedBy: null,
      rejectReason: null,
    };

    const repo = createMockRepo();
    const result = await tryApplyProposal(
      repo,
      proposal,
      createMockCurrentParams(),
      createMockContext(),
      createMockOptions(),
    );

    expect(result.isOk()).toBe(true);
    expect(result.value).toBe(null); // Rejected
  });

  test("should accept new format with structured rollbackConditions", async () => {
    const proposal: LlmProposal = {
      id: "proposal-126",
      exchange: "extended",
      symbol: "BTC-USD",
      ts: new Date(),
      inputWindowStart: new Date(),
      inputWindowEnd: new Date(),
      currentParamsSetId: "params-123",
      // NEW FORMAT: object
      proposalJson: { baseHalfSpreadBps: "5.5" }, // +10%
      // NEW FORMAT: structured object
      rollbackJson: { markout10sP50BelowBps: -10 },
      reasoningLogPath: "/path/to/log.json",
      reasoningLogSha256: "abc123",
      status: "pending",
      decidedAt: null,
      decidedBy: null,
      rejectReason: null,
    };

    const repo = createMockRepo();
    const result = await tryApplyProposal(
      repo,
      proposal,
      createMockCurrentParams(),
      createMockContext(),
      createMockOptions(),
    );

    expect(result.isOk()).toBe(true);
    // This should pass format validation, though it may still be rejected by
    // core param-gate if the change exceeds 10%. 5.0 -> 5.5 is exactly 10%,
    // so it should pass with epsilon tolerance.
    expect(result.value).not.toBe(null);
  });
});
