/**
 * ParamGate - LLM Proposal Validation
 *
 * Requirements: 10.2, 10.5
 * - Schema validation
 * - Constraint validation: max 2 parameters, block only "excessive" changes
 * - Rollback conditions required
 *
 * This module is pure logic (no I/O dependencies).
 */

import type { StrategyParams } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rollback conditions for a proposal
 */
export interface RollbackConditions {
  /** Rollback if markout 10s P50 falls below this value (bps) */
  markout10sP50BelowBps?: number;
  /** Rollback if PAUSE count exceeds this in 1 hour */
  pauseCountAbove?: number;
  /** Rollback after this duration (ms) regardless of performance */
  maxDurationMs?: number;
}

/**
 * A parameter change proposal from LLM
 */
export interface ParamProposal {
  /** Changed parameters (max 2) */
  changes: Partial<Record<keyof StrategyParams, string | number>>;
  /** Conditions that trigger automatic rollback */
  rollbackConditions: RollbackConditions;
}

/**
 * Validation result
 */
export interface ParamGateResult {
  valid: boolean;
  errors: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Allowed parameter keys for modification
 */
export const ALLOWED_PARAM_KEYS: readonly (keyof StrategyParams)[] = [
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
] as const;

/** Maximum number of parameter changes allowed */
const MAX_CHANGES = 2;

interface ChangeRule {
  /** Minimum allowed ratio (proposed/current) when current != 0 */
  minRatio: number;
  /** Maximum allowed ratio (proposed/current) when current != 0 */
  maxRatio: number;
  /** Whether negative values are allowed */
  allowNegative: boolean;
  /** Absolute hard cap to catch magnitude hallucinations */
  absMax: number;
}

/**
 * "Excessive" change guardrails.
 *
 * Goal: avoid rejecting normal tuning (10-30% tweaks),
 * while catching clearly unreasonable LLM outputs (orders of magnitude, sign flips).
 */
const CHANGE_RULES: Record<keyof StrategyParams, ChangeRule> = {
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
};

// ─────────────────────────────────────────────────────────────────────────────
// Validation Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a proposed value is "excessive" relative to the current value.
 */
export function isWithinReasonableRange(
  param: keyof StrategyParams,
  original: number | string,
  proposed: number | string,
): boolean {
  const origNum = typeof original === "string" ? Number.parseFloat(original) : original;
  const propNum = typeof proposed === "string" ? Number.parseFloat(proposed) : proposed;

  if (!Number.isFinite(origNum) || !Number.isFinite(propNum)) return false;

  // eslint-disable-next-line security/detect-object-injection
  const rule = CHANGE_RULES[param];
  if (!rule.allowNegative && propNum < 0) return false;
  if (Math.abs(propNum) > rule.absMax) return false;

  // Add small epsilon for floating point comparison
  const epsilon = 1e-9;
  if (origNum === 0) {
    // When current is 0, we can't compute ratio reliably; only allow small/finite values.
    // absMax and non-negative checks above are the main guard.
    return true;
  }

  const ratio = propNum / origNum;
  return ratio <= rule.maxRatio + epsilon && ratio >= rule.minRatio - epsilon;
}

/**
 * Check if the number of changes is within the limit
 */
export function isWithinChangeLimit(changes: Record<string, unknown>, limit: number): boolean {
  return Object.keys(changes).length <= limit;
}

/**
 * Check if rollback conditions are present
 */
function hasRollbackConditions(conditions: RollbackConditions): boolean {
  return (
    conditions.markout10sP50BelowBps !== undefined ||
    conditions.pauseCountAbove !== undefined ||
    conditions.maxDurationMs !== undefined
  );
}

/**
 * Validate a parameter proposal
 *
 * Requirements:
 * - Max 2 parameter changes (10.2)
 * - Each change must not be "excessive" (10.2)
 * - Rollback conditions required (10.2)
 * - Valid parameter keys only
 */
export function validateProposal(proposal: ParamProposal, currentParams: StrategyParams): ParamGateResult {
  const errors: string[] = [];

  // Check change limit
  if (!isWithinChangeLimit(proposal.changes, MAX_CHANGES)) {
    errors.push("CHANGE_LIMIT_EXCEEDED");
  }

  // Check each change
  for (const [key, proposedValue] of Object.entries(proposal.changes)) {
    // Check valid key
    if (!ALLOWED_PARAM_KEYS.includes(key as keyof StrategyParams)) {
      errors.push(`INVALID_PARAM_KEY:${key}`);
      continue;
    }

    // Get current value
    const currentValue = currentParams[key as keyof StrategyParams];

    // Check excessive change guardrails
    if (!isWithinReasonableRange(key as keyof StrategyParams, currentValue, proposedValue)) {
      errors.push(`EXCESSIVE_CHANGE:${key}`);
    }
  }

  // Check rollback conditions
  if (!hasRollbackConditions(proposal.rollbackConditions)) {
    errors.push("ROLLBACK_CONDITIONS_REQUIRED");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
