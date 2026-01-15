import { describe, expect, it, mock } from "bun:test";

mock.module("@ai-sdk/openai", () => ({
  openai: (modelName: string) => ({ provider: "openai", modelName }),
}));

mock.module("ai", () => ({
  generateText: async () => ({
    text: JSON.stringify({
      changes: {
        baseHalfSpreadBps: "1.6",
      },
      rollbackConditions: { markout10sP50BelowBps: -5 },
      reasoningTrace: ["Small, conservative adjustment."],
    }),
  }),
}));

import { generateProposal } from "../src/services/proposal-generator";
import { extractFirstJsonObject } from "../src/services/llm-output-parser";

describe("proposal-generator", () => {
  it("returns proposal when AI returns structured `output`", async () => {
    const result = await generateProposal(
      { model: "gpt-4o" },
      {
        exchange: "extended",
        symbol: "BTC-USD",
        aggregation: {
          windowStart: new Date("2026-01-14T06:00:00.000Z"),
          windowEnd: new Date("2026-01-14T07:00:00.000Z"),
          fillsCount: 1,
          cancelCount: 0,
          pauseCount: 0,
          markout10sP10: -1,
          markout10sP50: -1,
          markout10sP90: -1,
          worstFills: [],
        },
        currentParams: {
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
        },
      },
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.proposal.changes.baseHalfSpreadBps).toBe("1.6");
      // Undefined entries should be filtered out
      expect("volSpreadGain" in result.value.proposal.changes).toBe(false);
      expect(result.value.reasoningTrace.length).toBeGreaterThan(0);
    }
  });

  it("extracts JSON from fenced output", () => {
    const out = extractFirstJsonObject('```json\n{"a":1}\n```');
    expect(out).toBe('{"a":1}');
  });

  it("extracts first JSON object from noisy output", () => {
    const out = extractFirstJsonObject('note:\n{"a": {"b": 2}} trailing');
    expect(out).toBe('{"a": {"b": 2}}');
  });
});
