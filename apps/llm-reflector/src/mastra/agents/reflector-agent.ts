/**
 * Reflector Agent
 *
 * Requirements: 10.1
 * - Mastra Agent for generating parameter proposals
 * - Uses structured output with Zod schema
 */

import { Agent } from "@mastra/core/agent";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";

import { ProposalOutputSchema } from "../../types/schemas";

const REFLECTOR_INSTRUCTIONS = `You are a market making strategy optimization assistant. Your role is to analyze trading performance data and suggest parameter adjustments to improve profitability while managing risk.

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
3. You MUST provide rollback conditions (when to revert changes)
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

Respond with a JSON object containing your proposed changes, rollback conditions, and reasoning.`;

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
function createModel(modelString: string): LanguageModelV1 {
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
  const model = createModel(modelString);

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
