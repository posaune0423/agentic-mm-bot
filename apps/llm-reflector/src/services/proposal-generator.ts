/**
 * Proposal Generator Service - LLM Integration
 *
 * Requirements: 10.1, 10.2
 * - Generate proposals using LLM (OpenAI)
 * - Input: hourly aggregation + worst fills (top5) + current params
 * - Output: max 2 parameter changes, ±10%, with rollback conditions
 */

import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { ResultAsync } from "neverthrow";
import { z } from "zod";

import type { LlmInputSummary, LlmProposalOutput } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ProposalGeneratorError =
  | { type: "LLM_API_ERROR"; message: string }
  | { type: "INVALID_RESPONSE"; message: string };

// ─────────────────────────────────────────────────────────────────────────────
// Zod Schemas for LLM Output
// ─────────────────────────────────────────────────────────────────────────────

const RollbackConditionsSchema = z.object({
  markout10sP50BelowBps: z.number().optional(),
  pauseCountAbove: z.number().optional(),
  maxDurationMs: z.number().optional(),
});

const ParamChangeSchema = z.object({
  baseHalfSpreadBps: z.string().optional(),
  volSpreadGain: z.string().optional(),
  toxSpreadGain: z.string().optional(),
  quoteSizeUsd: z.string().optional(),
  refreshIntervalMs: z.number().optional(),
  staleCancelMs: z.number().optional(),
  maxInventory: z.string().optional(),
  inventorySkewGain: z.string().optional(),
  pauseMarkIndexBps: z.string().optional(),
  pauseLiqCount10s: z.number().optional(),
});

const LlmResponseSchema = z.object({
  changes: ParamChangeSchema,
  rollbackConditions: RollbackConditionsSchema,
  reasoningTrace: z.array(z.string()),
});

// ─────────────────────────────────────────────────────────────────────────────
// Prompt Generation
// ─────────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are an expert market making parameter optimizer for a cryptocurrency trading bot.

Your task is to analyze the last hour's trading performance and suggest parameter adjustments to improve profitability while managing risk.

CONSTRAINTS (MUST FOLLOW):
1. You can change AT MOST 2 parameters at a time
2. Each parameter change must be within ±10% of the current value
3. You MUST provide rollback conditions

PARAMETERS YOU CAN ADJUST:
- baseHalfSpreadBps: Base half spread in basis points (higher = wider spread)
- volSpreadGain: Multiplier for volatility-based spread adjustment
- toxSpreadGain: Multiplier for toxicity-based spread adjustment
- quoteSizeUsd: Size of each quote in USD
- refreshIntervalMs: Minimum interval between quote updates
- staleCancelMs: Cancel orders older than this duration
- maxInventory: Maximum allowed inventory before pausing
- inventorySkewGain: Skew quotes based on inventory
- pauseMarkIndexBps: Mark-Index divergence threshold for pause
- pauseLiqCount10s: Liquidation count threshold for pause

INTERPRETATION:
- Negative markout = LOSING money (adverse selection)
- Positive markout = MAKING money (good fills)
- High PAUSE count = Too sensitive or volatile market conditions
- High cancel count = Orders being refreshed frequently

STRATEGY:
- If markout is very negative, consider widening spreads or reducing size
- If markout is positive and stable, consider tightening spreads slightly
- If many PAUSEs, consider adjusting thresholds or reducing exposure
- Be conservative - small changes are preferred

ROLLBACK CONDITIONS (must include at least one):
- markout10sP50BelowBps: Rollback if median markout falls below this (in bps)
- pauseCountAbove: Rollback if PAUSE count exceeds this in 1 hour
- maxDurationMs: Rollback after this duration regardless of performance`;
}

function buildUserPrompt(input: LlmInputSummary): string {
  const { aggregation, currentParams } = input;

  const worstFillsText = aggregation.worstFills
    .map(
      (f, i) =>
        `  ${i + 1}. ${f.side} @ ${f.fillPx} (size: ${f.fillSz}, markout10s: ${f.markout10sBps ?? "N/A"} bps)`,
    )
    .join("\n");

  return `Analyze the following trading performance and suggest parameter adjustments:

## Last Hour Summary (${aggregation.windowStart.toISOString()} to ${aggregation.windowEnd.toISOString()})

- Fills: ${aggregation.fillsCount}
- Cancels: ${aggregation.cancelCount}
- PAUSEs: ${aggregation.pauseCount}
- Markout 10s (P10/P50/P90): ${aggregation.markout10sP10?.toFixed(2) ?? "N/A"} / ${aggregation.markout10sP50?.toFixed(2) ?? "N/A"} / ${aggregation.markout10sP90?.toFixed(2) ?? "N/A"} bps

## Worst Fills (by markout)
${worstFillsText || "  No fills in this period"}

## Current Parameters
- baseHalfSpreadBps: ${currentParams.baseHalfSpreadBps}
- volSpreadGain: ${currentParams.volSpreadGain}
- toxSpreadGain: ${currentParams.toxSpreadGain}
- quoteSizeUsd: ${currentParams.quoteSizeUsd}
- refreshIntervalMs: ${currentParams.refreshIntervalMs}
- staleCancelMs: ${currentParams.staleCancelMs}
- maxInventory: ${currentParams.maxInventory}
- inventorySkewGain: ${currentParams.inventorySkewGain}
- pauseMarkIndexBps: ${currentParams.pauseMarkIndexBps}
- pauseLiqCount10s: ${currentParams.pauseLiqCount10s}

Based on this analysis, suggest parameter changes (max 2, each within ±10%) with clear reasoning.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Proposal Generator
// ─────────────────────────────────────────────────────────────────────────────

export interface ProposalGeneratorOptions {
  model: string;
}

/**
 * Generate a parameter proposal using LLM
 */
export function generateProposal(
  options: ProposalGeneratorOptions,
  input: LlmInputSummary,
): ResultAsync<LlmProposalOutput, ProposalGeneratorError> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(input);

  return ResultAsync.fromPromise(
    generateObject({
      model: openai(options.model),
      schema: LlmResponseSchema,
      system: systemPrompt,
      prompt: userPrompt,
    }),
    (e) => ({
      type: "LLM_API_ERROR" as const,
      message: e instanceof Error ? e.message : "Unknown error",
    }),
  ).map((result) => {
    const obj = result.object as z.infer<typeof LlmResponseSchema>;

    // Filter out undefined values from changes
    const filteredChanges: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(obj.changes)) {
      if (typeof value === "string" || typeof value === "number") {
        filteredChanges[key] = value;
      }
    }

    return {
      proposal: {
        changes: filteredChanges,
        rollbackConditions: obj.rollbackConditions,
      },
      reasoningTrace: obj.reasoningTrace,
    };
  });
}
