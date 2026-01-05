/**
 * LLM Reflector Main Entry Point
 *
 * Requirements: 10.1, 10.2, 13.1
 * - Generate proposals every hour
 * - Input: last hour aggregation + worst fills (top5) + current params
 * - Output: proposal saved to DB + reasoning log to file
 */

import { v4 as uuidv4 } from "uuid";

import { validateProposal, type StrategyParams } from "@agentic-mm-bot/core";
import { getDb } from "@agentic-mm-bot/db";
import { logger } from "@agentic-mm-bot/utils";

import { env } from "./env";
import { createPostgresProposalRepository, createPostgresMetricsRepository } from "./repositories";
import { saveReasoningLog } from "./services/file-sink";
import { generateProposal } from "./services/proposal-generator";
import type { LlmInputSummary, CurrentParamsSummary } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert CurrentParamsSummary to StrategyParams for validation
 */
function toStrategyParams(params: CurrentParamsSummary): StrategyParams {
  return {
    baseHalfSpreadBps: params.baseHalfSpreadBps,
    volSpreadGain: params.volSpreadGain,
    toxSpreadGain: params.toxSpreadGain,
    quoteSizeBase: params.quoteSizeBase,
    refreshIntervalMs: params.refreshIntervalMs,
    staleCancelMs: params.staleCancelMs,
    maxInventory: params.maxInventory,
    inventorySkewGain: params.inventorySkewGain,
    pauseMarkIndexBps: params.pauseMarkIndexBps,
    pauseLiqCount10s: params.pauseLiqCount10s,
  } satisfies StrategyParams;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info("Starting llm-reflector");

  const db = getDb(env.DATABASE_URL);

  const proposalRepo = createPostgresProposalRepository(db);
  const metricsRepo = createPostgresMetricsRepository(db);

  const runReflection = async (): Promise<void> => {
    const now = new Date();
    const windowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
    const windowStart = new Date(windowEnd.getTime() - 3600_000);

    logger.info("Running reflection", {
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    });

    // Get current params
    const paramsResult = await metricsRepo.getCurrentParams(env.EXCHANGE, env.SYMBOL);
    if (paramsResult.isErr()) {
      logger.error("Failed to get current params", { error: paramsResult.error });
      return;
    }
    const currentParams = paramsResult.value;

    // Get hourly aggregation
    const aggResult = await metricsRepo.getHourlyAggregation(env.EXCHANGE, env.SYMBOL, windowStart, windowEnd);
    if (aggResult.isErr()) {
      logger.error("Failed to get hourly aggregation", { error: aggResult.error });
      return;
    }
    const aggregation = aggResult.value;

    // Skip if no activity
    if (aggregation.fillsCount === 0 && aggregation.cancelCount === 0) {
      logger.info("No activity in last hour, skipping reflection");
      return;
    }

    // Build LLM input
    const llmInput: LlmInputSummary = {
      exchange: env.EXCHANGE,
      symbol: env.SYMBOL,
      aggregation,
      currentParams,
    };

    logger.info("Generating proposal", {
      fills: aggregation.fillsCount,
      cancels: aggregation.cancelCount,
      pauses: aggregation.pauseCount,
      markout10sP50: aggregation.markout10sP50,
    });

    // Generate proposal using LLM
    const proposalResult = await generateProposal({ model: env.OPENAI_MODEL }, llmInput);
    if (proposalResult.isErr()) {
      logger.error("Failed to generate proposal", { error: proposalResult.error });
      return;
    }
    const { proposal, reasoningTrace } = proposalResult.value;

    // Validate proposal using ParamGate
    const validationResult = validateProposal(proposal, toStrategyParams(currentParams));

    if (!validationResult.valid) {
      logger.warn("Proposal failed validation", { errors: validationResult.errors });
      return;
    }

    // Generate proposal ID
    const proposalId = uuidv4();
    const timestamp = new Date();

    // Save reasoning log to file
    const fileSinkResult = await saveReasoningLog(
      { logDir: env.LOG_DIR },
      env.EXCHANGE,
      env.SYMBOL,
      proposalId,
      timestamp,
      {
        proposalId,
        timestamp: timestamp.toISOString(),
        inputSummary: llmInput,
        currentParams,
        proposal: proposal,
        rollbackConditions: proposal.rollbackConditions,
        reasoningTrace,
      },
    );

    if (fileSinkResult.isErr()) {
      logger.error("Failed to save reasoning log", { error: fileSinkResult.error });
      // Don't save proposal to DB if file sink failed (requirement 13.1)
      return;
    }

    const { logPath, sha256 } = fileSinkResult.value;

    // Save proposal to DB
    const dbResult = await proposalRepo.saveProposal({
      id: proposalId,
      exchange: env.EXCHANGE,
      symbol: env.SYMBOL,
      ts: timestamp,
      inputWindowStart: windowStart,
      inputWindowEnd: windowEnd,
      currentParamsSetId: currentParams.paramsSetId,
      proposalJson: proposal.changes,
      rollbackJson: proposal.rollbackConditions,
      reasoningLogPath: logPath,
      reasoningLogSha256: sha256,
      status: "pending",
    });

    if (dbResult.isErr()) {
      logger.error("Failed to save proposal to DB", { error: dbResult.error });
      return;
    }

    logger.info("Proposal saved successfully", {
      proposalId,
      changes: Object.keys(proposal.changes),
      logPath,
    });
  };

  // Run immediately
  await runReflection();

  // Run periodically
  const interval = setInterval(() => {
    void runReflection();
  }, env.RUN_INTERVAL_MS);

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    logger.info("Shutting down...");
    clearInterval(interval);
    await db.$client.end();
    logger.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  logger.info("LLM Reflector running", {
    interval: `${env.RUN_INTERVAL_MS}ms`,
  });
}

main().catch(error => {
  logger.error("Fatal error", error);
  process.exit(1);
});
