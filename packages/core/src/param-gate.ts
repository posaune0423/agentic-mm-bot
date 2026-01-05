/**
 * ParamGate - LLM Proposal Validation
 *
 * Requirements: 10.2, 10.5
 * - Schema validation
 * - Constraint validation: max 2 parameters, ±10% each
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

/** Maximum percentage change allowed (±10%) */
const MAX_PERCENTAGE_CHANGE = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Validation Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a value change is within the allowed percentage range
 */
export function isWithinPercentageRange(
  original: number | string,
  proposed: number | string,
  maxPercentage: number,
): boolean {
  const origNum =
    typeof original === "string" ? parseFloat(original) : original;
  const propNum =
    typeof proposed === "string" ? parseFloat(proposed) : proposed;

  // Edge case: if original is 0, only allow 0 as proposed
  if (origNum === 0) {
    return propNum === 0;
  }

  const percentChange = Math.abs((propNum - origNum) / origNum) * 100;

  // Add small epsilon for floating point comparison
  const epsilon = 1e-9;
  return percentChange <= maxPercentage + epsilon;
}

/**
 * Check if the number of changes is within the limit
 */
export function isWithinChangeLimit(
  changes: Record<string, unknown>,
  limit: number,
): boolean {
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
 * - Each change within ±10% (10.2)
 * - Rollback conditions required (10.2)
 * - Valid parameter keys only
 */
export function validateProposal(
  proposal: ParamProposal,
  currentParams: StrategyParams,
): ParamGateResult {
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

    // Check percentage range
    if (
      !isWithinPercentageRange(
        currentValue,
        proposedValue,
        MAX_PERCENTAGE_CHANGE,
      )
    ) {
      errors.push(`PERCENTAGE_EXCEEDED:${key}`);
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
