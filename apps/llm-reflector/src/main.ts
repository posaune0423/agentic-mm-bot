/**
 * LLM Reflector Main Entry Point
 *
 * Requirements: 10.1, 13.1
 * - Interval-based worker (similar to summarizer)
 * - Runs periodic reflection to generate parameter proposals
 * - Graceful shutdown
 */

import { getDb } from "@agentic-mm-bot/db";
import { createPostgresMetricsRepository, createPostgresProposalRepository } from "@agentic-mm-bot/repositories";
import { createIntervalWorker, logger } from "@agentic-mm-bot/utils";

import { loadEnv } from "./env";
import { createFileSinkPort } from "./ports/file-sink-port";
import { runHourlyReflection } from "./usecases/run-hourly-reflection/usecase";

function main(): void {
  const env = loadEnv();

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
    const result = await runHourlyReflection(deps, env.REFLECTION_WINDOW_MINUTES);

    if (result.isOk()) {
      const value = result.value;

      switch (value.type) {
        case "SUCCESS":
          logger.info("Reflection succeeded", {
            proposalId: value.result.proposalId,
          });
          break;
        case "SKIPPED":
          logger.debug("Reflection skipped", { reason: value.reason });
          break;
        case "ERROR":
          logger.error("Reflection failed", { error: value.error });
          break;
      }
    }
  };

  createIntervalWorker({
    name: "LLM Reflector",
    intervalMs: env.RUN_INTERVAL_MS,
    runOnce,
    startupMetadata: {
      exchange: env.EXCHANGE,
      symbol: env.SYMBOL,
      model: env.MODEL,
      runIntervalMs: env.RUN_INTERVAL_MS,
      reflectionWindowMinutes: env.REFLECTION_WINDOW_MINUTES,
    },
  });
}

main();
