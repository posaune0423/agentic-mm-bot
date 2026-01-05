/**
 * Summarizer Main Entry Point
 *
 * Requirements: 9.1-9.6
 * - Generate fills_enriched from ex_fill
 * - Calculate markout at 1s/10s/60s
 * - Reference price is mid
 * - Features at fill time (9.5): spread, imbalance, vol, mark_index_div, liq_count
 * - Worst fills extraction and aggregations (9.6)
 *
 * This file is the composition root - orchestration only, no business logic.
 */

import { config } from "dotenv";
import { resolve } from "path";

// Load .env from project root (three levels up from apps/summarizer)
config({ path: resolve(process.cwd(), "../../.env") });

import { getDb } from "@agentic-mm-bot/db";
import { createIntervalWorker, logger } from "@agentic-mm-bot/utils";

import { env } from "./env";
import { processUnprocessedFills } from "./usecases/process-fills";
import { generate1MinAggregation, generate1HourAggregation } from "./services";

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function main(): void {
  const db = getDb(env.DATABASE_URL);

  let lastMinuteAgg = 0;
  let lastHourAgg = 0;

  const runOnce = async (): Promise<void> => {
    // Process fills (with horizon gate: only ts <= now-60s)
    const processed = await processUnprocessedFills(db);
    if (processed > 0) {
      logger.info("Processed fills", { count: processed });
    }

    // Generate 1-minute aggregation
    const now = Date.now();
    const currentMinute = Math.floor(now / 60_000);
    if (currentMinute > lastMinuteAgg) {
      await generate1MinAggregation(db, env.EXCHANGE, env.SYMBOL);
      lastMinuteAgg = currentMinute;
    }

    // Generate 1-hour aggregation
    const currentHour = Math.floor(now / 3600_000);
    if (currentHour > lastHourAgg) {
      await generate1HourAggregation(db, env.EXCHANGE, env.SYMBOL);
      lastHourAgg = currentHour;
    }
  };

  createIntervalWorker({
    name: "Summarizer",
    intervalMs: env.RUN_INTERVAL_MS,
    runOnce,
    cleanup: async () => {
      await db.$client.end();
    },
  });
}

main();
