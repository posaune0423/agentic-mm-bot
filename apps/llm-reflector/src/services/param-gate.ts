/**
 * Param Gate - Proposal Validation
 *
 * Requirements: 10.2, 10.5
 * - Maximum 2 parameter changes
 * - Each change within ±10% of current value
 * - Rollback conditions required
 */

import { type Result, err, ok } from "neverthrow";

import type { CurrentParamsSummary } from "@agentic-mm-bot/repositories";

import type { ParamName, ProposalOutput } from "../types/schemas";

export type ParamGateError =
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

/**
 * Get current value for a parameter from strategy params
 */
function getCurrentValue(
  params: CurrentParamsSummary,
  param: ParamName,
): number {
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
 * Validate a proposal against the param gate rules
 *
 * Rules:
 * 1. Maximum 2 parameter changes
 * 2. Each change must be within ±10% of current value
 * 3. Rollback conditions are required
 */
export function validateProposal(
  proposal: ProposalOutput,
  currentParams: CurrentParamsSummary,
): Result<void, ParamGateError> {
  // 1. Maximum 2 changes
  if (proposal.changes.length > 2) {
    return err({
      type: "TOO_MANY_CHANGES",
      count: proposal.changes.length,
    });
  }

  // 2. Each change within ±10%
  for (const change of proposal.changes) {
    const currentValue = getCurrentValue(currentParams, change.param);
    const proposedValue = parseFloat(change.toValue);

    if (Number.isNaN(proposedValue)) {
      return err({
        type: "INVALID_PARAM_VALUE",
        param: change.param,
        value: change.toValue,
      });
    }

    // Handle edge case where current value is 0
    if (currentValue === 0) {
      // If current is 0, only allow small absolute changes
      if (Math.abs(proposedValue) > 0.1) {
        return err({
          type: "CHANGE_EXCEEDS_10PCT",
          param: change.param,
          currentValue,
          proposedValue,
          diffPct: 100,
        });
      }
      continue;
    }

    const diffPct =
      Math.abs((proposedValue - currentValue) / currentValue) * 100;

    if (diffPct > 10) {
      return err({
        type: "CHANGE_EXCEEDS_10PCT",
        param: change.param,
        currentValue,
        proposedValue,
        diffPct,
      });
    }
  }

  // 3. Rollback conditions required
  if (proposal.rollbackConditions.length === 0) {
    return err({
      type: "MISSING_ROLLBACK_CONDITIONS",
    });
  }

  return ok(undefined);
}
