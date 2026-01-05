/**
 * LLM Reflector Types
 *
 * Requirements: 10.1, 10.2, 13.1
 */

import type { ParamProposal, RollbackConditions } from "@agentic-mm-bot/core";
import type {
  HourlyAggregation,
  CurrentParamsSummary,
} from "@agentic-mm-bot/repositories";

// Re-export shared types from repositories package
export type {
  HourlyAggregation,
  CurrentParamsSummary,
  WorstFillSummary,
} from "@agentic-mm-bot/repositories";

/**
 * LLM input summary
 */
export interface LlmInputSummary {
  exchange: string;
  symbol: string;
  aggregation: HourlyAggregation;
  currentParams: CurrentParamsSummary;
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM Output
// ─────────────────────────────────────────────────────────────────────────────

/**
 * LLM proposal output
 */
export interface LlmProposalOutput {
  proposal: ParamProposal;
  reasoningTrace: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Reasoning Log (for file persistence)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reasoning log content (Requirements: 13.3)
 */
export interface ReasoningLogContent {
  proposalId: string;
  timestamp: string;
  inputSummary: LlmInputSummary;
  currentParams: CurrentParamsSummary;
  proposal: ParamProposal;
  rollbackConditions: RollbackConditions;
  reasoningTrace: string[];
  integrity: {
    sha256: string;
  };
}

/**
 * File sink result
 */
export interface FileSinkResult {
  logPath: string;
  sha256: string;
}
