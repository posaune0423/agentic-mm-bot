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

import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";

import type { ChangeRule } from "@agentic-mm-bot/core";
import type { CurrentParamsSummary } from "@agentic-mm-bot/repositories";

import { ProposalOutputSchema } from "../types/schemas";
import type { ParamName, RollbackConditions } from "../types/schemas";

export type ParamGateError =
  | { type: "INVALID_PROPOSAL_SHAPE"; message: string }
  | { type: "TOO_MANY_CHANGES"; count: number }
  | {
      type: "EXCESSIVE_CHANGE";
      param: ParamName;
      currentValue: number;
      proposedValue: number;
      ratio?: number;
      reason: "RATIO_TOO_HIGH" | "RATIO_TOO_LOW" | "ABS_TOO_LARGE" | "NEGATIVE_NOT_ALLOWED" | "NON_FINITE";
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
  // Attack-defense parameters
  "defensiveSpreadMultiplier",
  "defensiveSizeMultiplier",
  "oneSidedThreshold",
  "oneSidedOnNonZeroInventory",
  "unwindTriggerMs",
  "unwindSizeRatio",
  "unwindCrossBps",
];

/**
 * "Excessive" change guardrails.
 *
 * Goal: avoid blocking normal reflection (e.g. 10-30% tweaks),
 * while catching clearly unreasonable LLM outputs (orders of magnitude, sign flips).
 */
const CHANGE_RULES: Record<ParamName, ChangeRule> = {
  baseHalfSpreadBps: {
    minRatio: 0.3,
    maxRatio: 3.0,
    allowNegative: false,
    absMax: 1e6,
  },
  volSpreadGain: {
    minRatio: 0.3,
    maxRatio: 3.0,
    allowNegative: false,
    absMax: 1e6,
  },
  toxSpreadGain: {
    minRatio: 0.3,
    maxRatio: 3.0,
    allowNegative: false,
    absMax: 1e6,
  },
  quoteSizeUsd: {
    minRatio: 0.2,
    maxRatio: 5.0,
    allowNegative: false,
    absMax: 1e9,
  },
  refreshIntervalMs: {
    minRatio: 0.1,
    maxRatio: 10.0,
    allowNegative: false,
    absMax: 1e9,
  },
  staleCancelMs: {
    minRatio: 0.1,
    maxRatio: 10.0,
    allowNegative: false,
    absMax: 1e9,
  },
  maxInventory: {
    minRatio: 0.2,
    maxRatio: 5.0,
    allowNegative: false,
    absMax: 1e9,
  },
  inventorySkewGain: {
    minRatio: 0.3,
    maxRatio: 3.0,
    allowNegative: false,
    absMax: 1e6,
  },
  pauseMarkIndexBps: {
    minRatio: 0.2,
    maxRatio: 5.0,
    allowNegative: false,
    absMax: 1e9,
  },
  pauseLiqCount10s: {
    minRatio: 0.1,
    maxRatio: 10.0,
    allowNegative: false,
    absMax: 1e9,
  },
  // Attack-defense parameters
  defensiveSpreadMultiplier: {
    minRatio: 0.5,
    maxRatio: 2.0,
    allowNegative: false,
    absMax: 100,
  },
  defensiveSizeMultiplier: {
    minRatio: 0.2,
    maxRatio: 2.0,
    allowNegative: false,
    absMax: 100,
  },
  oneSidedThreshold: {
    minRatio: 0.5,
    maxRatio: 2.0,
    allowNegative: false,
    absMax: 1,
  },
  oneSidedOnNonZeroInventory: {
    // Boolean parameter - ratio check doesn't apply meaningfully
    minRatio: 0,
    maxRatio: Number.MAX_VALUE,
    allowNegative: false,
    absMax: 1,
  },
  unwindTriggerMs: {
    minRatio: 0.2,
    maxRatio: 5.0,
    allowNegative: false,
    absMax: 1e9,
  },
  unwindSizeRatio: {
    minRatio: 0.2,
    maxRatio: 5.0,
    allowNegative: false,
    absMax: 1,
  },
  unwindCrossBps: {
    minRatio: 0.1,
    maxRatio: 10.0,
    allowNegative: false,
    absMax: 100,
  },
};

function getChangeRule(param: ParamName): ChangeRule {
  switch (param) {
    case "baseHalfSpreadBps":
      return CHANGE_RULES.baseHalfSpreadBps;
    case "volSpreadGain":
      return CHANGE_RULES.volSpreadGain;
    case "toxSpreadGain":
      return CHANGE_RULES.toxSpreadGain;
    case "quoteSizeUsd":
      return CHANGE_RULES.quoteSizeUsd;
    case "refreshIntervalMs":
      return CHANGE_RULES.refreshIntervalMs;
    case "staleCancelMs":
      return CHANGE_RULES.staleCancelMs;
    case "maxInventory":
      return CHANGE_RULES.maxInventory;
    case "inventorySkewGain":
      return CHANGE_RULES.inventorySkewGain;
    case "pauseMarkIndexBps":
      return CHANGE_RULES.pauseMarkIndexBps;
    case "pauseLiqCount10s":
      return CHANGE_RULES.pauseLiqCount10s;
    // Attack-defense parameters
    case "defensiveSpreadMultiplier":
      return CHANGE_RULES.defensiveSpreadMultiplier;
    case "defensiveSizeMultiplier":
      return CHANGE_RULES.defensiveSizeMultiplier;
    case "oneSidedThreshold":
      return CHANGE_RULES.oneSidedThreshold;
    case "oneSidedOnNonZeroInventory":
      return CHANGE_RULES.oneSidedOnNonZeroInventory;
    case "unwindTriggerMs":
      return CHANGE_RULES.unwindTriggerMs;
    case "unwindSizeRatio":
      return CHANGE_RULES.unwindSizeRatio;
    case "unwindCrossBps":
      return CHANGE_RULES.unwindCrossBps;
  }
}

/**
 * Default values for attack-defense parameters (used when DB has null)
 */
const ATTACK_DEFENSE_DEFAULTS = {
  defensiveSpreadMultiplier: 1.5,
  defensiveSizeMultiplier: 0.5,
  oneSidedThreshold: 0.3,
  oneSidedOnNonZeroInventory: 0, // false -> 0 for ratio checks
  unwindTriggerMs: 30000,
  unwindSizeRatio: 0.25,
  unwindCrossBps: 0,
};

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
    case "baseHalfSpreadBps":
      return Number.parseFloat(params.baseHalfSpreadBps);
    case "volSpreadGain":
      return Number.parseFloat(params.volSpreadGain);
    case "toxSpreadGain":
      return Number.parseFloat(params.toxSpreadGain);
    case "quoteSizeUsd":
      return Number.parseFloat(params.quoteSizeUsd);
    case "maxInventory":
      return Number.parseFloat(params.maxInventory);
    case "inventorySkewGain":
      return Number.parseFloat(params.inventorySkewGain);
    case "pauseMarkIndexBps":
      return Number.parseFloat(params.pauseMarkIndexBps);
    // Attack-defense parameters (return default if null)
    case "defensiveSpreadMultiplier":
      return params.defensiveSpreadMultiplier !== null ?
          Number.parseFloat(params.defensiveSpreadMultiplier)
        : ATTACK_DEFENSE_DEFAULTS.defensiveSpreadMultiplier;
    case "defensiveSizeMultiplier":
      return params.defensiveSizeMultiplier !== null ?
          Number.parseFloat(params.defensiveSizeMultiplier)
        : ATTACK_DEFENSE_DEFAULTS.defensiveSizeMultiplier;
    case "oneSidedThreshold":
      return params.oneSidedThreshold !== null ?
          Number.parseFloat(params.oneSidedThreshold)
        : ATTACK_DEFENSE_DEFAULTS.oneSidedThreshold;
    case "oneSidedOnNonZeroInventory":
      // Boolean -> 0 or 1 for ratio checks
      return (
        params.oneSidedOnNonZeroInventory !== null ?
          params.oneSidedOnNonZeroInventory ?
            1
          : 0
        : ATTACK_DEFENSE_DEFAULTS.oneSidedOnNonZeroInventory
      );
    case "unwindTriggerMs":
      return params.unwindTriggerMs !== null ? params.unwindTriggerMs : ATTACK_DEFENSE_DEFAULTS.unwindTriggerMs;
    case "unwindSizeRatio":
      return params.unwindSizeRatio !== null ?
          Number.parseFloat(params.unwindSizeRatio)
        : ATTACK_DEFENSE_DEFAULTS.unwindSizeRatio;
    case "unwindCrossBps":
      return params.unwindCrossBps !== null ?
          Number.parseFloat(params.unwindCrossBps)
        : ATTACK_DEFENSE_DEFAULTS.unwindCrossBps;
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

function parseNumber(
  value: string | number,
): { ok: true; value: number } | { ok: false; reason: "NAN" | "NON_FINITE" } {
  const n = typeof value === "string" ? Number.parseFloat(value) : value;
  if (Number.isNaN(n)) return { ok: false, reason: "NAN" };
  if (!Number.isFinite(n)) return { ok: false, reason: "NON_FINITE" };
  return { ok: true, value: n };
}

/**
 * Validate a proposal against the param gate rules
 *
 * Rules:
 * 1. Maximum 2 parameter changes
 * 2. Each change must not be "excessive" (block only unreasonable magnitudes/signs)
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

  // 2. Guard against excessive changes (avoid blocking normal reflection)
  for (const [param, proposedValue] of changes) {
    if (!ALLOWED_PARAMS.includes(param)) {
      return err({
        type: "INVALID_PROPOSAL_SHAPE",
        message: `Invalid parameter: ${param}`,
      });
    }

    const currentValue = getCurrentValue(currentParams, param);
    const parsedProposed = parseNumber(proposedValue);

    if (!parsedProposed.ok) {
      if (parsedProposed.reason === "NAN") {
        return err({
          type: "INVALID_PARAM_VALUE",
          param,
          value: String(proposedValue),
        });
      }

      return err({
        type: "EXCESSIVE_CHANGE",
        param,
        currentValue,
        proposedValue: typeof proposedValue === "string" ? Number.NaN : proposedValue,
        reason: "NON_FINITE",
      });
    }

    const proposedNum = parsedProposed.value;

    const rule = getChangeRule(param);
    // Basic sign sanity
    if (!rule.allowNegative && proposedNum < 0) {
      return err({
        type: "EXCESSIVE_CHANGE",
        param,
        currentValue,
        proposedValue: proposedNum,
        reason: "NEGATIVE_NOT_ALLOWED",
      });
    }

    // Absolute hard cap to catch magnitude hallucinations
    if (Math.abs(proposedNum) > rule.absMax) {
      return err({
        type: "EXCESSIVE_CHANGE",
        param,
        currentValue,
        proposedValue: proposedNum,
        reason: "ABS_TOO_LARGE",
      });
    }

    // Relative guardrail (primary)
    if (currentValue !== 0) {
      const ratio = proposedNum / currentValue;
      const epsilon = 1e-9;
      if (ratio > rule.maxRatio + epsilon) {
        return err({
          type: "EXCESSIVE_CHANGE",
          param,
          currentValue,
          proposedValue: proposedNum,
          ratio,
          reason: "RATIO_TOO_HIGH",
        });
      }
      if (ratio < rule.minRatio - epsilon) {
        return err({
          type: "EXCESSIVE_CHANGE",
          param,
          currentValue,
          proposedValue: proposedNum,
          ratio,
          reason: "RATIO_TOO_LOW",
        });
      }
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
