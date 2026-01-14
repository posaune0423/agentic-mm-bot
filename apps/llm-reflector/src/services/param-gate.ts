/**
 * Param Gate - Proposal Validation
 *
 * Requirements: 10.2, 10.5
 * - Maximum 2 parameter changes
 * - Each change within ±10% of current value
 * - Rollback conditions required (structured object with at least one condition)
 *
 * IMPORTANT: This validates the NEW format (object-based changes, structured rollback).
 */

import { type Result, err, ok } from "neverthrow";

import type { CurrentParamsSummary } from "@agentic-mm-bot/repositories";

import { type ParamName, ProposalOutputSchema, type RollbackConditions } from "../types/schemas";

export type ParamGateError =
  | { type: "INVALID_PROPOSAL_SHAPE"; message: string }
  | { type: "TOO_MANY_CHANGES"; count: number }
  | {
      type: "CHANGE_EXCEEDS_10PCT";
      param: ParamName;
      currentValue: number;
      proposedValue: number;
      diffPct: number;
    }
  | { type: "MISSING_ROLLBACK_CONDITIONS" }
  | { type: "INVALID_PARAM_VALUE"; param: ParamName; value: string };

/** Allowed parameter names */
const ALLOWED_PARAMS: readonly ParamName[] = [
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
];

/**
 * Get current value for a parameter from strategy params
 */
function getCurrentValue(params: CurrentParamsSummary, param: ParamName): number {
  switch (param) {
    case "refreshIntervalMs":
      return params.refreshIntervalMs;
    case "staleCancelMs":
      return params.staleCancelMs;
    case "pauseLiqCount10s":
      return params.pauseLiqCount10s;
    default:
      return parseFloat(params[param]);
  }
}

/**
 * Check if rollback conditions are present (at least one must be set)
 */
function hasRollbackConditions(conditions: RollbackConditions): boolean {
  return (
    conditions.markout10sP50BelowBps !== undefined ||
    conditions.pauseCountAbove !== undefined ||
    conditions.maxDurationMs !== undefined
  );
}

/**
 * Validate a proposal against the param gate rules
 *
 * Rules:
 * 1. Maximum 2 parameter changes
 * 2. Each change must be within ±10% of current value
 * 3. Rollback conditions are required (structured object)
 */
export function validateProposal(proposal: unknown, currentParams: CurrentParamsSummary): Result<void, ParamGateError> {
  // First, validate the shape using the schema
  const parsed = ProposalOutputSchema.safeParse(proposal);
  if (!parsed.success) {
    return err({
      type: "INVALID_PROPOSAL_SHAPE",
      message: parsed.error.issues.map(i => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; "),
    });
  }

  const proposalOutput = parsed.data;

  // Extract changes
  const changes = Object.entries(proposalOutput.changes) as [ParamName, string | number][];

  // 1. Maximum 2 changes
  if (changes.length > 2) {
    return err({
      type: "TOO_MANY_CHANGES",
      count: changes.length,
    });
  }

  // 2. Each change within ±10%
  for (const [param, proposedValue] of changes) {
    if (!ALLOWED_PARAMS.includes(param)) {
      return err({
        type: "INVALID_PROPOSAL_SHAPE",
        message: `Invalid parameter: ${param}`,
      });
    }

    const currentValue = getCurrentValue(currentParams, param);
    const proposedNum = typeof proposedValue === "string" ? parseFloat(proposedValue) : proposedValue;

    if (Number.isNaN(proposedNum)) {
      return err({
        type: "INVALID_PARAM_VALUE",
        param,
        value: String(proposedValue),
      });
    }

    // Handle edge case where current value is 0
    if (currentValue === 0) {
      if (Math.abs(proposedNum) > 0.1) {
        return err({
          type: "CHANGE_EXCEEDS_10PCT",
          param,
          currentValue,
          proposedValue: proposedNum,
          diffPct: 100,
        });
      }
      continue;
    }

    const diffPct = Math.abs((proposedNum - currentValue) / currentValue) * 100;

    if (diffPct > 10) {
      return err({
        type: "CHANGE_EXCEEDS_10PCT",
        param,
        currentValue,
        proposedValue: proposedNum,
        diffPct,
      });
    }
  }

  // 3. Rollback conditions required (at least one must be set)
  if (!hasRollbackConditions(proposalOutput.rollbackConditions)) {
    return err({
      type: "MISSING_ROLLBACK_CONDITIONS",
    });
  }

  return ok(undefined);
}
