/**
 * LLM Reflector Data Contracts (Zod Schemas)
 *
 * Requirements: 10.1, 10.2, 10.3, 13.3
 * - ProposalOutput: max 2 changes (object format), ±10%, rollback required (structured)
 * - ReasoningLog: file format with sha256 integrity
 *
 * IMPORTANT: This schema must match the format expected by executor/core (ParamProposal).
 * - changes: { [paramName]: value } (object, not array)
 * - rollbackConditions: { markout10sP50BelowBps?, pauseCountAbove?, maxDurationMs? } (at least one required)
 *
 * Note: Aggregation and CurrentParams types are imported from @agentic-mm-bot/repositories
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Param Names (for reference/validation)
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

// ─────────────────────────────────────────────────────────────────────────────
// Rollback Conditions Schema (structured object)
// ─────────────────────────────────────────────────────────────────────────────

export const RollbackConditionsSchema = z
  .object({
    /** Rollback if markout 10s P50 falls below this value (bps) */
    markout10sP50BelowBps: z.number().optional(),
    /** Rollback if PAUSE count exceeds this in 1 hour */
    pauseCountAbove: z.number().optional(),
    /** Rollback after this duration (ms) regardless of performance */
    maxDurationMs: z.number().optional(),
  })
  .refine(
    data =>
      data.markout10sP50BelowBps !== undefined ||
      data.pauseCountAbove !== undefined ||
      data.maxDurationMs !== undefined,
    { message: "At least one rollback condition is required" },
  );

export type RollbackConditions = z.infer<typeof RollbackConditionsSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Changes Schema (object format: { paramName: value })
// ─────────────────────────────────────────────────────────────────────────────

export const ChangesSchema = z
  .object({
    baseHalfSpreadBps: z.union([z.string(), z.number()]).optional(),
    volSpreadGain: z.union([z.string(), z.number()]).optional(),
    toxSpreadGain: z.union([z.string(), z.number()]).optional(),
    quoteSizeUsd: z.union([z.string(), z.number()]).optional(),
    refreshIntervalMs: z.number().optional(),
    staleCancelMs: z.number().optional(),
    maxInventory: z.union([z.string(), z.number()]).optional(),
    inventorySkewGain: z.union([z.string(), z.number()]).optional(),
    pauseMarkIndexBps: z.union([z.string(), z.number()]).optional(),
    pauseLiqCount10s: z.number().optional(),
  })
  .refine(
    data => {
      const definedKeys = Object.keys(data);
      return definedKeys.length >= 1 && definedKeys.length <= 2;
    },
    { message: "Must have 1-2 parameter changes" },
  );

export type Changes = z.infer<typeof ChangesSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Proposal Output Schema (10.2) - New format compatible with executor/core
// ─────────────────────────────────────────────────────────────────────────────

export const ProposalOutputSchema = z.object({
  /** Parameter changes as { paramName: newValue } object (max 2 keys) */
  changes: ChangesSchema,
  /** Structured rollback conditions (at least one required) */
  rollbackConditions: RollbackConditionsSchema,
  /** Reasoning trace for audit/debugging */
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
