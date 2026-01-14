/**
 * Proposal Applier Service
 *
 * Requirements: 10.4, 10.5, 10.6
 * - Apply proposals at 5-minute boundaries (max 1 per boundary)
 * - Validate using ParamGate
 * - Operational gates: PAUSE count, data quality, markout
 * - Save audit log to param_rollout
 *
 * IMPORTANT: Only accepts NEW format proposals:
 * - proposalJson: { [paramName]: value } (object, not array)
 * - rollbackJson: { markout10sP50BelowBps?, pauseCountAbove?, maxDurationMs? } (structured object)
 * Old format (array-based changes, string array rollback) is explicitly rejected.
 */

import type { ResultAsync } from "neverthrow";
import { ok, err } from "neverthrow";
import {
  validateProposal,
  type ParamProposal,
  type RollbackConditions,
  type StrategyParams as CoreStrategyParams,
} from "@agentic-mm-bot/core";
import type { LlmProposal, StrategyParams, NewStrategyParams } from "@agentic-mm-bot/db";
import { logger } from "@agentic-mm-bot/utils";

import type { ProposalRepository } from "@agentic-mm-bot/repositories";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ProposalApplierError =
  | { type: "VALIDATION_FAILED"; errors: string[] }
  | { type: "OPERATIONAL_GATE_FAILED"; reason: string }
  | { type: "FORMAT_MISMATCH"; reason: string }
  | { type: "DB_ERROR"; message: string };

export interface OperationalContext {
  /** Number of PAUSEs in last hour */
  pauseCountLastHour: number;
  /** Whether data is stale */
  dataStale: boolean;
  /** Markout 10s P50 (if available) */
  markout10sP50?: number;
  /** Whether there are pending DB write failures */
  dbWriteFailures: boolean;
  /** Whether there are exchange errors */
  exchangeErrors: boolean;
}

export interface ProposalApplierOptions {
  exchange: string;
  symbol: string;
  /** Maximum PAUSEs before rejecting proposals */
  maxPauseCountForApply: number;
  /** Markout threshold below which proposals are rejected */
  minMarkout10sP50ForApply: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if we're at a 5-minute boundary
 */
export function isAtFiveMinuteBoundary(nowMs: number): boolean {
  return isAtTimeBoundary(nowMs, { boundaryMinutes: 5, graceSeconds: 30 });
}

export function isAtTimeBoundary(nowMs: number, opts: { boundaryMinutes: number; graceSeconds: number }): boolean {
  const boundaryMinutes = Math.max(1, Math.floor(opts.boundaryMinutes));
  const graceSeconds = Math.max(0, Math.floor(opts.graceSeconds));

  const date = new Date(nowMs);
  const minutes = date.getUTCMinutes();
  const seconds = date.getUTCSeconds();

  return minutes % boundaryMinutes === 0 && seconds < graceSeconds;
}

/**
 * Convert DB StrategyParams to Core StrategyParams
 */
function toCoreparams(params: StrategyParams): CoreStrategyParams {
  return {
    baseHalfSpreadBps: params.baseHalfSpreadBps,
    volSpreadGain: params.volSpreadGain,
    toxSpreadGain: params.toxSpreadGain,
    quoteSizeUsd: params.quoteSizeUsd,
    refreshIntervalMs: params.refreshIntervalMs,
    staleCancelMs: params.staleCancelMs,
    maxInventory: params.maxInventory,
    inventorySkewGain: params.inventorySkewGain,
    pauseMarkIndexBps: params.pauseMarkIndexBps,
    pauseLiqCount10s: params.pauseLiqCount10s,
  };
}

/**
 * Apply changes to params
 *
 * Note: Integer fields (refreshIntervalMs, staleCancelMs, pauseLiqCount10s) are rounded
 * to ensure compatibility with the database schema.
 */
function applyChanges(
  current: StrategyParams,
  changes: Partial<Record<keyof StrategyParams, string | number>>,
): NewStrategyParams {
  return {
    exchange: current.exchange,
    symbol: current.symbol,
    isCurrent: false, // Will be set to true after insert
    createdBy: "llm",
    baseHalfSpreadBps: String(changes.baseHalfSpreadBps ?? current.baseHalfSpreadBps),
    volSpreadGain: String(changes.volSpreadGain ?? current.volSpreadGain),
    toxSpreadGain: String(changes.toxSpreadGain ?? current.toxSpreadGain),
    quoteSizeUsd: String(changes.quoteSizeUsd ?? current.quoteSizeUsd),
    refreshIntervalMs: Math.round(Number(changes.refreshIntervalMs ?? current.refreshIntervalMs)),
    staleCancelMs: Math.round(Number(changes.staleCancelMs ?? current.staleCancelMs)),
    maxInventory: String(changes.maxInventory ?? current.maxInventory),
    inventorySkewGain: String(changes.inventorySkewGain ?? current.inventorySkewGain),
    pauseMarkIndexBps: String(changes.pauseMarkIndexBps ?? current.pauseMarkIndexBps),
    pauseLiqCount10s: Math.round(Number(changes.pauseLiqCount10s ?? current.pauseLiqCount10s)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Format Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate proposal format matches the NEW format (object-based changes, structured rollback).
 *
 * OLD format (rejected):
 * - proposalJson: [{ param, fromValue, toValue }] (array)
 * - rollbackJson: ["string condition", ...] (string array)
 *
 * NEW format (accepted):
 * - proposalJson: { baseHalfSpreadBps: "1.6", ... } (object with param keys)
 * - rollbackJson: { markout10sP50BelowBps?: number, pauseCountAbove?: number, maxDurationMs?: number }
 */
function validateProposalFormat(
  proposalJson: unknown,
  rollbackJson: unknown,
): { valid: true } | { valid: false; reason: string } {
  // Check if proposalJson is old array format
  if (Array.isArray(proposalJson)) {
    return {
      valid: false,
      reason: "proposalJson is array format (old). Expected object format { paramName: value }",
    };
  }

  // Check if proposalJson is a non-null object
  if (typeof proposalJson !== "object" || proposalJson === null) {
    return {
      valid: false,
      reason: `proposalJson is not an object. Got ${typeof proposalJson}`,
    };
  }

  // Check if rollbackJson is old string array format
  if (Array.isArray(rollbackJson)) {
    return {
      valid: false,
      reason:
        "rollbackJson is string array format (old). Expected structured object { markout10sP50BelowBps?, pauseCountAbove?, maxDurationMs? }",
    };
  }

  // Check if rollbackJson is a non-null object
  if (typeof rollbackJson !== "object" || rollbackJson === null) {
    return {
      valid: false,
      reason: `rollbackJson is not an object. Got ${typeof rollbackJson}`,
    };
  }

  // Verify rollbackJson has at least one valid condition
  const rb = rollbackJson as Record<string, unknown>;
  const hasValidCondition =
    typeof rb.markout10sP50BelowBps === "number" ||
    typeof rb.pauseCountAbove === "number" ||
    typeof rb.maxDurationMs === "number";

  if (!hasValidCondition) {
    return {
      valid: false,
      reason:
        "rollbackJson has no valid conditions. At least one of markout10sP50BelowBps, pauseCountAbove, maxDurationMs must be set",
    };
  }

  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check operational gates
 *
 * Requirements: 10.5
 * - Reject if HARD PAUSE多発
 * - Reject if データ欠損
 * - Reject if 取引所エラー
 * - Reject if markout極端悪化
 */
function checkOperationalGates(
  context: OperationalContext,
  options: ProposalApplierOptions,
): { pass: boolean; reason?: string } {
  if (context.dbWriteFailures) {
    return { pass: false, reason: "DB write failures detected" };
  }

  if (context.exchangeErrors) {
    return { pass: false, reason: "Exchange errors detected" };
  }

  if (context.dataStale) {
    return { pass: false, reason: "Data is stale" };
  }

  if (context.pauseCountLastHour > options.maxPauseCountForApply) {
    return {
      pass: false,
      reason: `PAUSE count (${context.pauseCountLastHour}) exceeds limit (${options.maxPauseCountForApply})`,
    };
  }

  if (context.markout10sP50 !== undefined && context.markout10sP50 < options.minMarkout10sP50ForApply) {
    return {
      pass: false,
      reason: `Markout P50 (${context.markout10sP50}) below threshold (${options.minMarkout10sP50ForApply})`,
    };
  }

  return { pass: true };
}

/**
 * Try to apply a pending proposal
 *
 * Requirements: 10.4, 10.5, 10.6
 */
export async function tryApplyProposal(
  repo: ProposalRepository,
  proposal: LlmProposal,
  currentParams: StrategyParams,
  context: OperationalContext,
  options: ProposalApplierOptions,
): Promise<ResultAsync<StrategyParams | null, ProposalApplierError>> {
  // Step 0: Format validation (new format only)
  const formatCheck = validateProposalFormat(proposal.proposalJson, proposal.rollbackJson);
  if (!formatCheck.valid) {
    await repo.updateProposalStatus(proposal.id, "rejected", "executor", `Format mismatch: ${formatCheck.reason}`);

    await repo.saveParamRollout({
      ts: new Date(),
      exchange: options.exchange,
      symbol: options.symbol,
      proposalId: proposal.id,
      fromParamsSetId: currentParams.id,
      toParamsSetId: null,
      action: "reject",
      reason: `Format: ${formatCheck.reason}`,
    });

    logger.warn("Proposal rejected: format mismatch (old format)", {
      proposalId: proposal.id,
      reason: formatCheck.reason,
    });

    return ok(null);
  }

  // Step 1: Schema validation (10.5)
  const proposalData: ParamProposal = {
    changes: proposal.proposalJson as Record<string, string | number>,
    rollbackConditions: proposal.rollbackJson as RollbackConditions,
  };

  const validationResult = validateProposal(proposalData, toCoreparams(currentParams));
  if (!validationResult.valid) {
    // Reject and save audit
    await repo.updateProposalStatus(
      proposal.id,
      "rejected",
      "executor",
      `Validation failed: ${validationResult.errors.join(", ")}`,
    );

    await repo.saveParamRollout({
      ts: new Date(),
      exchange: options.exchange,
      symbol: options.symbol,
      proposalId: proposal.id,
      fromParamsSetId: currentParams.id,
      toParamsSetId: null,
      action: "reject",
      reason: `Validation: ${validationResult.errors.join(", ")}`,
    });

    logger.warn("Proposal rejected: validation failed", {
      proposalId: proposal.id,
      errors: validationResult.errors,
    });

    return ok(null);
  }

  // Step 2: Operational gates (10.5)
  const gateResult = checkOperationalGates(context, options);
  if (!gateResult.pass) {
    await repo.updateProposalStatus(proposal.id, "rejected", "executor", `Operational gate: ${gateResult.reason}`);

    await repo.saveParamRollout({
      ts: new Date(),
      exchange: options.exchange,
      symbol: options.symbol,
      proposalId: proposal.id,
      fromParamsSetId: currentParams.id,
      toParamsSetId: null,
      action: "reject",
      reason: `Operational: ${gateResult.reason}`,
    });

    logger.warn("Proposal rejected: operational gate", {
      proposalId: proposal.id,
      reason: gateResult.reason,
    });

    return ok(null);
  }

  // Step 3: Apply the proposal
  const newParamsData = applyChanges(currentParams, proposalData.changes);

  const createResult = await repo.createStrategyParams(newParamsData);
  if (createResult.isErr()) {
    return err({ type: "DB_ERROR", message: createResult.error.message });
  }
  const newParams = createResult.value;

  // Set as current
  const setResult = await repo.setCurrentParams(options.exchange, options.symbol, newParams.id);
  if (setResult.isErr()) {
    return err({ type: "DB_ERROR", message: setResult.error.message });
  }

  // Update proposal status
  await repo.updateProposalStatus(proposal.id, "applied", "executor");

  // Save audit log
  await repo.saveParamRollout({
    ts: new Date(),
    exchange: options.exchange,
    symbol: options.symbol,
    proposalId: proposal.id,
    fromParamsSetId: currentParams.id,
    toParamsSetId: newParams.id,
    action: "apply",
    reason: `Applied changes: ${Object.keys(proposalData.changes).join(", ")}`,
    metricsSnapshotJson: {
      pauseCountLastHour: context.pauseCountLastHour,
      markout10sP50: context.markout10sP50,
    },
  });

  logger.info("Proposal applied", {
    proposalId: proposal.id,
    changes: Object.keys(proposalData.changes),
    newParamsId: newParams.id,
  });

  return ok(newParams);
}

/** Result of processing pending proposals */
export type ProcessProposalResult =
  | { type: "no_pending" }
  | { type: "applied"; params: StrategyParams; changedKeys: string[] }
  | { type: "rejected"; proposalId: string; reason: string }
  | { type: "error"; message: string };

/**
 * Process pending proposals at N-minute boundaries
 *
 * Requirements: 10.4
 * - Apply at minute boundaries (max 1 per boundary)
 */
export async function processPendingProposals(
  repo: ProposalRepository,
  options: ProposalApplierOptions,
  context: OperationalContext,
  nowMs: number,
  timing: { boundaryMinutes: number; graceSeconds: number } = { boundaryMinutes: 5, graceSeconds: 30 },
): Promise<ProcessProposalResult> {
  // Only process at configured boundaries
  if (!isAtTimeBoundary(nowMs, timing)) {
    return { type: "no_pending" };
  }

  // Get current params
  const paramsResult = await repo.getCurrentParams(options.exchange, options.symbol);
  if (paramsResult.isErr()) {
    logger.error("Failed to get current params", { error: paramsResult.error });
    return { type: "error", message: paramsResult.error.message };
  }
  const currentParams = paramsResult.value;

  // Get pending proposals
  const proposalsResult = await repo.getPendingProposals(options.exchange, options.symbol);
  if (proposalsResult.isErr()) {
    logger.error("Failed to get pending proposals", { error: proposalsResult.error });
    return { type: "error", message: proposalsResult.error.message };
  }
  const proposals = proposalsResult.value;

  if (proposals.length === 0) {
    return { type: "no_pending" };
  }

  // Take the oldest pending proposal (first in list)
  const proposal = proposals[0];

  logger.info("Processing pending proposal", { proposalId: proposal.id });

  const result = await tryApplyProposal(repo, proposal, currentParams, context, options);
  if (result.isErr()) {
    logger.error("Failed to apply proposal", { error: result.error });
    const errMsg =
      result.error.type === "DB_ERROR" ? result.error.message
      : result.error.type === "VALIDATION_FAILED" ? result.error.errors.join(", ")
      : result.error.type === "OPERATIONAL_GATE_FAILED" ? result.error.reason
      : result.error.reason;
    return { type: "error", message: errMsg };
  }

  // If result is ok but value is null, it was rejected
  if (result.value === null) {
    // The detailed reason was already logged and saved to DB in tryApplyProposal
    // Provide a summary reason for the UI notification
    return {
      type: "rejected",
      proposalId: proposal.id,
      reason: "validation/format/operational",
    };
  }

  // Calculate changed keys
  const changedKeys: string[] = [];
  for (const key of Object.keys(result.value) as (keyof StrategyParams)[]) {
    if (String(result.value[key]) !== String(currentParams[key])) {
      changedKeys.push(key);
    }
  }

  return { type: "applied", params: result.value, changedKeys };
}
