/**
 * LLM Reflector Main Entry Point
 *
 * Requirements: 10.1, 13.1
 * - Interval-based worker (similar to summarizer)
 * - Runs hourly reflection to generate parameter proposals
 * - Graceful shutdown
 */

import { getDb } from "@agentic-mm-bot/db";
import { createPostgresMetricsRepository, createPostgresProposalRepository } from "@agentic-mm-bot/repositories";
import { logger } from "@agentic-mm-bot/utils";

import { loadEnv } from "./env";
import { createFileSinkPort } from "./ports/file-sink-port";
import { runHourlyReflection } from "./usecases/run-hourly-reflection/usecase";

async function main(): Promise<void> {
  const env = loadEnv();

  logger.info("Starting LLM Reflector", {
    exchange: env.EXCHANGE,
    symbol: env.SYMBOL,
    model: env.MODEL,
    runIntervalMs: env.RUN_INTERVAL_MS,
  });

  // Initialize DB connection
  const db = getDb(env.DATABASE_URL);

  // Initialize repositories and ports
  const metricsRepo = createPostgresMetricsRepository(db);
  const proposalRepo = createPostgresProposalRepository(db);
  const fileSink = createFileSinkPort();

  // Build dependencies
  const deps = {
    metricsRepo,
    proposalRepo,
    fileSink,
    model: env.MODEL,
    logDir: env.LOG_DIR,
    exchange: env.EXCHANGE,
    symbol: env.SYMBOL,
  };

  /**
   * Run one iteration
   */
  const runOnce = async (): Promise<void> => {
    const result = await runHourlyReflection(deps);

    if (result.isOk()) {
      const value = result.value;

      switch (value.type) {
        case "SUCCESS":
          logger.info("Hourly reflection succeeded", {
            proposalId: value.result.proposalId,
          });
          break;
        case "SKIPPED":
          logger.debug("Hourly reflection skipped", { reason: value.reason });
          break;
        case "ERROR":
          logger.error("Hourly reflection failed", { error: value.error });
          break;
      }
    }
  };

  // Run immediately
  await runOnce();

  // Run periodically
  const interval = setInterval(() => {
    void runOnce();
  }, env.RUN_INTERVAL_MS);

  // Graceful shutdown
  const shutdown = (): void => {
    logger.info("Shutting down...");
    clearInterval(interval);
    logger.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  logger.info("LLM Reflector running");
}

main().catch(error => {
  logger.error("Fatal error", error);
  process.exit(1);
});
