/**
 * LLM Reflector Data Contracts (Zod Schemas)
 *
 * Requirements: 10.1, 10.2, 10.3, 13.3
 * - ProposalOutput: max 2 changes, ±10%, rollback required
 * - ReasoningLog: file format with sha256 integrity
 *
 * Note: Aggregation and CurrentParams types are imported from @agentic-mm-bot/repositories
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Param Change Schema
// ─────────────────────────────────────────────────────────────────────────────

export const ParamNameSchema = z.enum([
  "baseHalfSpreadBps",
  "volSpreadGain",
  "toxSpreadGain",
  "quoteSizeUsd",
  "refreshIntervalMs",
  "staleCancelMs",
  "maxInventory",
  "inventorySkewGain",
  "pauseMarkIndexBps",
  "pauseLiqCount10s",
]);

export type ParamName = z.infer<typeof ParamNameSchema>;

export const ParamChangeSchema = z.object({
  param: ParamNameSchema,
  fromValue: z.string(),
  toValue: z.string(),
});

export type ParamChange = z.infer<typeof ParamChangeSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Proposal Output Schema (10.2)
// ─────────────────────────────────────────────────────────────────────────────

export const ProposalOutputSchema = z.object({
  changes: z.array(ParamChangeSchema).min(1).max(2),
  rollbackConditions: z.array(z.string()).min(1),
  reasoningTrace: z.array(z.string()).min(1),
});

export type ProposalOutput = z.infer<typeof ProposalOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Reasoning Log Schema (13.3)
// ─────────────────────────────────────────────────────────────────────────────

export const ReasoningLogSchema = z.object({
  proposalId: z.uuid(),
  timestamp: z.iso.datetime(),
  exchange: z.string(),
  symbol: z.string(),
  inputSummary: z.object({
    windowStart: z.iso.datetime(),
    windowEnd: z.iso.datetime(),
    fillsCount: z.number(),
    cancelCount: z.number(),
    pauseCount: z.number(),
    markout10sP50: z.number().nullable(),
    worstFillsCount: z.number(),
  }),
  currentParams: z.object({
    paramsSetId: z.uuid(),
    baseHalfSpreadBps: z.string(),
    volSpreadGain: z.string(),
    toxSpreadGain: z.string(),
    quoteSizeUsd: z.string(),
    refreshIntervalMs: z.number(),
    staleCancelMs: z.number(),
    maxInventory: z.string(),
    inventorySkewGain: z.string(),
    pauseMarkIndexBps: z.string(),
    pauseLiqCount10s: z.number(),
  }),
  proposal: ProposalOutputSchema,
  integrity: z.object({
    sha256: z.string(),
  }),
});

export type ReasoningLog = z.infer<typeof ReasoningLogSchema>;
