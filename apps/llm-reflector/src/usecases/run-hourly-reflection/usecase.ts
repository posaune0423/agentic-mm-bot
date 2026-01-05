/**
 * Run Hourly Reflection Usecase
 *
 * Requirements: 10.1
 * - Orchestrates one reflection cycle
 * - Determines the correct time window (last complete hour)
 * - Handles idempotency (skip if already processed)
 */

import { type ResultAsync, okAsync } from "neverthrow";

import { logger } from "@agentic-mm-bot/utils";

import {
  executeReflectionWorkflow,
  type WorkflowDeps,
  type WorkflowError,
  type WorkflowResult,
} from "../../mastra/workflows/reflection-workflow";

export interface RunHourlyReflectionDeps extends WorkflowDeps {
  exchange: string;
  symbol: string;
}

export type RunResult =
  | { type: "SUCCESS"; result: WorkflowResult }
  | { type: "SKIPPED"; reason: string }
  | { type: "ERROR"; error: WorkflowError };

/**
 * Calculate the last complete hour window
 *
 * Example: If now is 12:34, returns { start: 11:00, end: 12:00 }
 */
export function getLastCompleteHourWindow(): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
  const start = new Date(end.getTime() - 3600_000);
  return { start, end };
}

/**
 * Check if we should run for the current hour
 * Returns true if we haven't run for the last complete hour yet
 */
let lastProcessedHour = -1;

export function shouldRunForCurrentHour(): boolean {
  const now = new Date();
  const currentHour = now.getHours();

  if (currentHour === lastProcessedHour) {
    return false;
  }

  return true;
}

/**
 * Mark the current hour as processed
 */
function markHourAsProcessed(): void {
  const now = new Date();
  lastProcessedHour = now.getHours();
}

/**
 * Execute the hourly reflection
 */
export function runHourlyReflection(deps: RunHourlyReflectionDeps): ResultAsync<RunResult, never> {
  // Check if we should run
  if (!shouldRunForCurrentHour()) {
    return okAsync({
      type: "SKIPPED" as const,
      reason: "Already processed this hour",
    });
  }

  const { start, end } = getLastCompleteHourWindow();

  logger.info("Starting hourly reflection", {
    exchange: deps.exchange,
    symbol: deps.symbol,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
  });

  return executeReflectionWorkflow(deps.exchange, deps.symbol, start, end, deps)
    .map((result): RunResult => {
      markHourAsProcessed();
      logger.info("Reflection completed successfully", {
        proposalId: result.proposalId,
        logPath: result.logPath,
      });
      return { type: "SUCCESS", result };
    })
    .orElse((error): ResultAsync<RunResult, never> => {
      if (error.type === "ALREADY_EXISTS") {
        markHourAsProcessed();
        logger.info("Reflection skipped - already exists", { message: error.message });
        return okAsync({ type: "SKIPPED", reason: error.message });
      }

      logger.error("Reflection failed", { error });
      return okAsync({ type: "ERROR", error });
    });
}
