/**
 * Run Periodic Reflection Usecase
 *
 * Requirements: 10.1
 * - Orchestrates one reflection cycle
 * - Determines the correct time window (last complete window)
 * - Handles idempotency (skip if already processed)
 */

import { okAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";

import { logger } from "@agentic-mm-bot/utils";

import { executeReflectionWorkflow } from "../../mastra/workflows/reflection-workflow";
import type { WorkflowDeps, WorkflowError, WorkflowResult } from "../../mastra/workflows/reflection-workflow";

export interface RunHourlyReflectionDeps extends WorkflowDeps {
  exchange: string;
  symbol: string;
}

export type RunResult =
  | { type: "SUCCESS"; result: WorkflowResult }
  | { type: "SKIPPED"; reason: string }
  | { type: "ERROR"; error: WorkflowError };

/**
 * Window execution guard.
 * Keeps in-memory idempotency so the interval worker doesn't re-run the same window.
 */
export function createWindowGuard(): {
  shouldRun: (windowEnd: Date) => boolean;
  markProcessed: (windowEnd: Date) => void;
} {
  let lastProcessedKey: string | null = null;

  return {
    shouldRun(windowEnd: Date): boolean {
      const key = windowEnd.toISOString();
      return key !== lastProcessedKey;
    },
    markProcessed(windowEnd: Date): void {
      lastProcessedKey = windowEnd.toISOString();
    },
  };
}

/**
 * Calculate the last complete N-minute window (UTC-aligned).
 *
 * windowMinutes must be an integer between 1 and 60 (windowMinutes ≤ 60).
 *
 * Examples (windowMinutes=5):
 * - If now is 00:07:30Z -> { start: 00:00Z, end: 00:05Z }
 * - If now is 00:10:00Z -> { start: 00:05Z, end: 00:10Z }
 */
export function getLastCompleteWindow(now: Date, windowMinutes: number): { start: Date; end: Date } {
  if (!Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 60) {
    throw new RangeError(
      "getLastCompleteWindow requires windowMinutes to be an integer between 1 and 60 (windowMinutes <= 60).",
    );
  }

  const minutes = windowMinutes;
  const truncatedToMinuteUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), 0, 0),
  );

  const alignedMinute = Math.floor(truncatedToMinuteUtc.getUTCMinutes() / minutes) * minutes;
  const end = new Date(truncatedToMinuteUtc);
  end.setUTCMinutes(alignedMinute, 0, 0);

  const start = new Date(end.getTime() - minutes * 60_000);
  return { start, end };
}

const windowGuard = createWindowGuard();

/**
 * Execute the periodic reflection.
 *
 * windowMinutes must be an integer between 1 and 60 (windowMinutes ≤ 60).
 */
export function runHourlyReflection(
  deps: RunHourlyReflectionDeps,
  windowMinutes: number = 60,
): ResultAsync<RunResult, never> {
  const now = new Date();

  let start: Date;
  let end: Date;
  try {
    const window = getLastCompleteWindow(now, windowMinutes);
    start = window.start;
    end = window.end;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid windowMinutes parameter";
    logger.error("Validation error in runHourlyReflection", {
      error: message,
      windowMinutes,
    });
    return okAsync({
      type: "ERROR",
      error: { type: "VALIDATION_ERROR", message },
    });
  }

  // Check if we should run (in-memory idempotency)
  if (!windowGuard.shouldRun(end)) {
    return okAsync({
      type: "SKIPPED" as const,
      reason: "Already processed this window",
    });
  }

  logger.info("Starting reflection", {
    exchange: deps.exchange,
    symbol: deps.symbol,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    windowMinutes,
  });

  return executeReflectionWorkflow(deps.exchange, deps.symbol, start, end, deps)
    .map((result): RunResult => {
      windowGuard.markProcessed(end);
      logger.info("Reflection completed successfully", {
        proposalId: result.proposalId,
        logPath: result.logPath,
      });
      return { type: "SUCCESS", result };
    })
    .orElse((error): ResultAsync<RunResult, never> => {
      if (error.type === "ALREADY_EXISTS") {
        windowGuard.markProcessed(end);
        logger.info("Reflection skipped - already exists", {
          message: error.message,
        });
        return okAsync({ type: "SKIPPED", reason: error.message });
      }

      if (error.type === "GATE_REJECTED") {
        // Gate rejection is an expected outcome (LLM may propose invalid changes).
        // Treat as a skip for this hour to avoid retry loops and noisy error logs.
        windowGuard.markProcessed(end);
        logger.warn("Reflection skipped - proposal rejected by gate", {
          error,
        });
        return okAsync({
          type: "SKIPPED",
          reason: `Proposal rejected by gate: ${error.error.type}`,
        });
      }

      logger.error("Reflection failed", { error });
      return okAsync({ type: "ERROR", error });
    });
}
