/**
 * Backtest Main Entry Point
 *
 * Requirements: 11.1-11.4
 * - Replay md_* data with fixed tick interval
 * - Use same core strategy logic
 * - Simulated execution (touch fill)
 * - Output metrics and CSV
 */

import type { StrategyParams } from "@agentic-mm-bot/core";
import { getDb } from "@agentic-mm-bot/db";
import { createPostgresMarketDataRepository } from "@agentic-mm-bot/repositories";
import { logger } from "@agentic-mm-bot/utils";

import { env } from "./env";
import { runBacktest, type BacktestConfig } from "./backtest-runner";

/**
 * Default strategy parameters for backtest
 * Can be customized via environment or config file in future
 */
const DEFAULT_PARAMS: StrategyParams = {
  baseHalfSpreadBps: "10",
  volSpreadGain: "1",
  toxSpreadGain: "1",
  quoteSizeUsd: "10",
  refreshIntervalMs: 1000,
  staleCancelMs: 5000,
  maxInventory: "1",
  inventorySkewGain: "5",
  pauseMarkIndexBps: "50",
  pauseLiqCount10s: 3,
};

async function main(): Promise<void> {
  logger.info("Starting backtest", {
    exchange: env.EXCHANGE,
    symbol: env.SYMBOL,
    startTime: env.START_TIME.toISOString(),
    endTime: env.END_TIME.toISOString(),
    tickIntervalMs: env.TICK_INTERVAL_MS,
    outputCsv: env.BACKTEST_OUT_CSV ?? "(stdout only)",
  });

  // Database connection
  const db = getDb(env.DATABASE_URL);

  // Create repository
  const marketDataRepo = createPostgresMarketDataRepository(db);

  // Backtest configuration
  const config: BacktestConfig = {
    exchange: env.EXCHANGE,
    symbol: env.SYMBOL,
    startTime: env.START_TIME,
    endTime: env.END_TIME,
    tickIntervalMs: env.TICK_INTERVAL_MS,
    params: DEFAULT_PARAMS,
    outputCsvPath: env.BACKTEST_OUT_CSV,
  };

  try {
    // Run backtest
    const results = await runBacktest(marketDataRepo, config);

    // Log results
    logger.info("Backtest completed", {
      totalFills: results.totalFills,
      totalCancels: results.totalCancels,
      pauseCount: results.pauseCount,
      avgMarkout10sBps: results.avgMarkout10sBps?.toFixed(4) ?? "N/A",
      finalPosition: results.finalPosition,
    });

    if (env.BACKTEST_OUT_CSV) {
      logger.info(`Fills written to: ${env.BACKTEST_OUT_CSV}`);
    }
  } finally {
    await db.$client.end();
  }
}

main().catch(error => {
  logger.error("Fatal error", error);
  process.exit(1);
});
