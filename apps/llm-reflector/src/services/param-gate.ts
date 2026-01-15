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
];

interface ChangeRule {
  /** Minimum allowed ratio (proposed/current) when current != 0 */
  minRatio: number;
  /** Maximum allowed ratio (proposed/current) when current != 0 */
  maxRatio: number;
  /** Whether negative values are allowed */
  allowNegative: boolean;
  /**
   * Absolute hard cap to catch LLM "hallucinated" magnitudes (e.g. 1e12).
   * This is intentionally very loose; relative ratio is the main guard.
   */
  absMax: number;
}

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

    const rule = CHANGE_RULES[param];
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
