/**
 * LLM Reflector Types
 *
 * Requirements: 10.1, 10.2, 13.1
 */

import type { ParamProposal, RollbackConditions } from "@agentic-mm-bot/core";

// ─────────────────────────────────────────────────────────────────────────────
// Input Summary (for LLM context)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Worst fill entry for LLM context
 */
export interface WorstFillSummary {
  fillId: string;
  ts: Date;
  side: string;
  fillPx: string;
  fillSz: string;
  markout10sBps: number | null;
}

/**
 * Hourly aggregation for LLM input
 */
export interface HourlyAggregation {
  windowStart: Date;
  windowEnd: Date;
  fillsCount: number;
  cancelCount: number;
  pauseCount: number;
  markout10sP10: number | null;
  markout10sP50: number | null;
  markout10sP90: number | null;
  worstFills: WorstFillSummary[];
}

/**
 * Current parameters for LLM input
 */
export interface CurrentParamsSummary {
  paramsSetId: string;
  baseHalfSpreadBps: string;
  volSpreadGain: string;
  toxSpreadGain: string;
  quoteSizeBase: string;
  refreshIntervalMs: number;
  staleCancelMs: number;
  maxInventory: string;
  inventorySkewGain: string;
  pauseMarkIndexBps: string;
  pauseLiqCount10s: number;
}

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
