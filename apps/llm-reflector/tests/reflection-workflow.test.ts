import { describe, expect, it, mock } from "bun:test";
import { okAsync } from "neverthrow";

// Mock external AI SDKs to avoid network calls and control outputs.
mock.module("@ai-sdk/openai", () => ({
  openai: (modelName: string) => ({ provider: "openai", modelName }),
}));

mock.module("ai", () => ({
  generateText: async () => ({
    text: JSON.stringify({
      changes: { baseHalfSpreadBps: "1.6" },
      rollbackConditions: { markout10sP50BelowBps: -10 },
      reasoningTrace: ["Slightly widen spread due to adverse selection."],
    }),
  }),
}));

import { executeReflectionWorkflow } from "../src/mastra/workflows/reflection-workflow";

describe("executeReflectionWorkflow", () => {
  it("succeeds when AI returns structured `output`", async () => {
    const windowStart = new Date("2026-01-14T06:00:00.000Z");
    const windowEnd = new Date("2026-01-14T07:00:00.000Z");

    const metricsRepo = {
      getHourlyAggregation: () =>
        okAsync({
          windowStart,
          windowEnd,
          fillsCount: 1,
          cancelCount: 0,
          pauseCount: 0,
          markout10sP10: -1,
          markout10sP50: -1,
          markout10sP90: -1,
          worstFills: [
            {
              fillId: "f1",
              ts: windowStart,
              side: "buy",
              fillPx: "100",
              fillSz: "1",
              markout10sBps: -1,
            },
          ],
        }),
      getCurrentParams: () =>
        okAsync({
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
        }),
    } as any;

    const fileSink = {
      writeJsonLog: () => okAsync({ path: "log.json", sha256: "dummy" }),
    } as any;

    const proposalRepo = {
      saveProposal: () => okAsync(undefined),
    } as any;

    const deps = {
      metricsRepo,
      proposalRepo,
      fileSink,
      model: "openai/gpt-4o",
      logDir: "logs",
    };

    const result = await executeReflectionWorkflow("extended", "BTC-USD", windowStart, windowEnd, deps);

    expect(result.isOk()).toBe(true);
  });
});
