/**
 * Proposal Applier Service
 *
 * Requirements: 10.4, 10.5, 10.6
 * - Apply proposals at 5-minute boundaries (max 1 per boundary)
 * - Validate using ParamGate
 * - Operational gates: PAUSE count, data quality, markout
 * - Save audit log to param_rollout
 */

import type { ResultAsync } from "neverthrow";
import { ok, err } from "neverthrow";
import { validateProposal, type ParamProposal, type StrategyParams as CoreStrategyParams } from "@agentic-mm-bot/core";
import type { LlmProposal, StrategyParams, NewStrategyParams } from "@agentic-mm-bot/db";
import { logger } from "@agentic-mm-bot/utils";

import type { ProposalRepository } from "@agentic-mm-bot/repositories";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ProposalApplierError =
  | { type: "VALIDATION_FAILED"; errors: string[] }
  | { type: "OPERATIONAL_GATE_FAILED"; reason: string }
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
  const minutes = Math.floor((nowMs / 1000 / 60) % 5);
  const seconds = Math.floor((nowMs / 1000) % 60);
  return minutes === 0 && seconds < 30; // Within first 30 seconds of boundary
}

/**
 * Convert DB StrategyParams to Core StrategyParams
 */
function toCoreparams(params: StrategyParams): CoreStrategyParams {
  return {
    baseHalfSpreadBps: String(params.baseHalfSpreadBps),
    volSpreadGain: String(params.volSpreadGain),
    toxSpreadGain: String(params.toxSpreadGain),
    quoteSizeUsd: String(params.quoteSizeUsd),
    refreshIntervalMs: params.refreshIntervalMs,
    staleCancelMs: params.staleCancelMs,
    maxInventory: String(params.maxInventory),
    inventorySkewGain: String(params.inventorySkewGain),
    pauseMarkIndexBps: String(params.pauseMarkIndexBps),
    pauseLiqCount10s: params.pauseLiqCount10s,
  };
}

/**
 * Apply changes to params
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
    refreshIntervalMs: Number(changes.refreshIntervalMs ?? current.refreshIntervalMs),
    staleCancelMs: Number(changes.staleCancelMs ?? current.staleCancelMs),
    maxInventory: String(changes.maxInventory ?? current.maxInventory),
    inventorySkewGain: String(changes.inventorySkewGain ?? current.inventorySkewGain),
    pauseMarkIndexBps: String(changes.pauseMarkIndexBps ?? current.pauseMarkIndexBps),
    pauseLiqCount10s: Number(changes.pauseLiqCount10s ?? current.pauseLiqCount10s),
  };
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
  // Step 1: Schema validation (10.5)
  const proposalData: ParamProposal = {
    changes: proposal.proposalJson as Record<string, string | number>,
    rollbackConditions: proposal.rollbackJson as ParamProposal["rollbackConditions"],
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

/**
 * Process pending proposals at 5-minute boundaries
 *
 * Requirements: 10.4
 * - Apply at 5-minute boundaries (max 1 per boundary)
 */
export async function processPendingProposals(
  repo: ProposalRepository,
  options: ProposalApplierOptions,
  context: OperationalContext,
  nowMs: number,
): Promise<StrategyParams | null> {
  // Only process at 5-minute boundaries
  if (!isAtFiveMinuteBoundary(nowMs)) {
    return null;
  }

  // Get current params
  const paramsResult = await repo.getCurrentParams(options.exchange, options.symbol);
  if (paramsResult.isErr()) {
    logger.error("Failed to get current params", { error: paramsResult.error });
    return null;
  }
  const currentParams = paramsResult.value;

  // Get pending proposals
  const proposalsResult = await repo.getPendingProposals(options.exchange, options.symbol);
  if (proposalsResult.isErr()) {
    logger.error("Failed to get pending proposals", {
      error: proposalsResult.error,
    });
    return null;
  }
  const proposals = proposalsResult.value;

  if (proposals.length === 0) {
    return null;
  }

  // Take the oldest pending proposal (first in list)
  const proposal = proposals[0];

  logger.info("Processing pending proposal", { proposalId: proposal.id });

  const result = await tryApplyProposal(repo, proposal, currentParams, context, options);
  if (result.isErr()) {
    logger.error("Failed to apply proposal", { error: result.error });
    return null;
  }

  return result.value;
}
