/**
 * Reflector Agent
 *
 * Requirements: 10.1
 * - Mastra Agent for generating parameter proposals
 * - Uses structured output with Zod schema
 */

import { Agent } from "@mastra/core/agent";
import { createOpenAI } from "@ai-sdk/openai";

import { ProposalOutputSchema } from "../../types/schemas";

export const REFLECTOR_INSTRUCTIONS = `You are a market making strategy optimization assistant. Your role is to analyze trading performance data and suggest parameter adjustments to improve profitability while managing risk.

## Context
You are optimizing parameters for a market making bot that:
- Maintains bid/ask quotes on a cryptocurrency perpetual exchange
- Uses a 3-state machine: NORMAL, DEFENSIVE, PAUSE
- Aims to capture spread while avoiding toxic flow (negative markout)

## Your Task
Based on the provided performance data (fills, markout, pause events), suggest parameter changes to improve performance.

## Constraints (CRITICAL - MUST FOLLOW)
1. You may change AT MOST 2 parameters
2. Each change must be within ±10% of the current value
3. You MUST provide at least one rollback condition (structured object)
4. You MUST explain your reasoning clearly

## Parameters You Can Adjust
- baseHalfSpreadBps: Base half-spread in basis points (higher = wider spread)
- volSpreadGain: How much spread widens with volatility
- toxSpreadGain: How much spread widens with toxic flow
- quoteSizeUsd: Quote size in USD (e.g. 100 for $100)
- refreshIntervalMs: How often quotes refresh (ms)
- staleCancelMs: When to cancel stale orders (ms)
- maxInventory: Maximum allowed inventory
- inventorySkewGain: How much to skew quotes based on inventory
- pauseMarkIndexBps: Mark-index divergence threshold for PAUSE
- pauseLiqCount10s: Liquidation count threshold for PAUSE

## Analysis Guidelines
- Negative markout = toxic flow is hurting us → consider widening spread
- High pause count = market conditions volatile → consider tightening pause thresholds
- Low fills = spread too wide → consider narrowing spread
- High inventory = not managing risk well → consider increasing skew

## Response Format (CRITICAL)
Your response MUST be a JSON object with this exact structure:
{
  "changes": {
    "<paramName>": <newValue>,  // 1-2 parameters only, e.g. "baseHalfSpreadBps": "5.5"
  },
  "rollbackConditions": {
    "markout10sP50BelowBps": <number>,  // optional: rollback if markout P50 falls below this
    "pauseCountAbove": <number>,         // optional: rollback if PAUSE count exceeds this
    "maxDurationMs": <number>            // optional: rollback after this duration (ms)
  },
  "reasoningTrace": ["reason1", "reason2", ...]  // explain your reasoning
}

IMPORTANT:
- "changes" is an OBJECT with parameter names as keys (NOT an array)
- "rollbackConditions" is a structured OBJECT (NOT an array of strings)
- At least ONE rollback condition must be set (not undefined)
- String parameters (like baseHalfSpreadBps) can be string or number
- Integer parameters (like refreshIntervalMs) must be numbers`;

/**
 * Parse model string (e.g., "openai/gpt-4o") into provider and model name
 */
function parseModelString(modelString: string): { provider: string; modelName: string } {
  const parts = modelString.split("/");
  if (parts.length < 2) {
    throw new Error(`Invalid model string: ${modelString}. Expected format: provider/model-name`);
  }
  return {
    provider: parts[0],
    modelName: parts.slice(1).join("/"),
  };
}

/**
 * Create a LanguageModelV1 from a model string
 */
function createModel(modelString: string): unknown {
  const { provider, modelName } = parseModelString(modelString);

  switch (provider) {
    case "openai": {
      const openai = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      return openai(modelName);
    }
    default:
      throw new Error(`Unsupported model provider: ${provider}`);
  }
}

/**
 * Create the reflector agent with the specified model
 */
export function createReflectorAgent(modelString: string): Agent {
  // NOTE: Mastra's Agent typing expects a specific AI SDK model type which can
  // drift across versions. The runtime model object is correct; we keep the
  // typing loose (via `unknown`) to avoid false-negative typecheck failures.
  type AgentModel = ConstructorParameters<typeof Agent>[0]["model"];
  const model = createModel(modelString) as AgentModel;

  return new Agent({
    name: "reflector-agent",
    instructions: REFLECTOR_INSTRUCTIONS,
    model,
  });
}

/**
 * Get the structured output schema for the agent
 */
export function getProposalSchema() {
  return ProposalOutputSchema;
}
