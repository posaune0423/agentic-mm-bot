/**
 * Summarizer Main Entry Point
 *
 * Requirements: 9.1-9.6
 * - Generate fills_enriched from ex_fill
 * - Calculate markout at 1s/10s/60s
 * - Reference price is mid
 * - Worst fills extraction and aggregations (9.6)
 */

import { eq, and, gte, lte, isNull, sql, asc, count } from "drizzle-orm";
import {
  exFill,
  fillsEnriched,
  mdBbo,
  exOrderEvent,
  strategyState,
  type Db,
  type ExFill,
  getDb,
} from "@agentic-mm-bot/db";
import { logger } from "@agentic-mm-bot/utils";

import { env } from "./env";

type DbType = Db;

/**
 * Aggregation result for a time window
 */
interface AggregationResult {
  windowStart: Date;
  windowEnd: Date;
  fillsCount: number;
  cancelCount: number;
  pauseCount: number;
  markout10sP10: number | null;
  markout10sP50: number | null;
  markout10sP90: number | null;
  worstFills: WorstFill[];
}

/**
 * Worst fill entry
 */
interface WorstFill {
  fillId: string;
  ts: Date;
  side: string;
  fillPx: string;
  fillSz: string;
  markout10sBps: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// BBO Lookup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find closest BBO to a timestamp
 */
async function findClosestBbo(
  db: DbType,
  exchange: string,
  symbol: string,
  targetTs: Date,
  toleranceMs: number = 1000,
): Promise<{ midPx: string; spreadBps: string } | null> {
  const minTs = new Date(targetTs.getTime() - toleranceMs);
  const maxTs = new Date(targetTs.getTime() + toleranceMs);

  const result = await db
    .select({
      midPx: mdBbo.midPx,
      bestBidPx: mdBbo.bestBidPx,
      bestAskPx: mdBbo.bestAskPx,
      ts: mdBbo.ts,
    })
    .from(mdBbo)
    .where(and(eq(mdBbo.exchange, exchange), eq(mdBbo.symbol, symbol), gte(mdBbo.ts, minTs), lte(mdBbo.ts, maxTs)))
    .orderBy(sql`ABS(EXTRACT(EPOCH FROM ${mdBbo.ts}) - EXTRACT(EPOCH FROM ${targetTs}::timestamp))`)
    .limit(1);

  if (result.length === 0) return null;

  const row = result[0];
  const mid = parseFloat(row.midPx);
  const bid = parseFloat(row.bestBidPx);
  const ask = parseFloat(row.bestAskPx);
  const spreadBps = mid > 0 ? ((ask - bid) / mid) * 10_000 : 0;

  return {
    midPx: row.midPx,
    spreadBps: spreadBps.toFixed(4),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Markout Calculation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate markout in bps
 *
 * For BUY: markout = (mid_t1 - fill_px) / mid_t0 * 10000
 * For SELL: markout = (fill_px - mid_t1) / mid_t0 * 10000
 */
function calculateMarkoutBps(side: string, fillPx: string, midT0: string, midT1: string | null): string | null {
  if (!midT1) return null;

  const fill = parseFloat(fillPx);
  const t0 = parseFloat(midT0);
  const t1 = parseFloat(midT1);

  if (t0 === 0) return null;

  const markout = side === "buy" ? ((t1 - fill) / t0) * 10_000 : ((fill - t1) / t0) * 10_000;

  return markout.toFixed(4);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fill Processing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process a single fill
 */
async function processFill(db: DbType, fill: ExFill): Promise<void> {
  // Get reference prices at different time horizons
  const t0 = await findClosestBbo(db, fill.exchange, fill.symbol, fill.ts, 500);
  const t1s = await findClosestBbo(db, fill.exchange, fill.symbol, new Date(fill.ts.getTime() + 1000), 500);
  const t10s = await findClosestBbo(db, fill.exchange, fill.symbol, new Date(fill.ts.getTime() + 10_000), 1000);
  const t60s = await findClosestBbo(db, fill.exchange, fill.symbol, new Date(fill.ts.getTime() + 60_000), 5000);

  // Calculate markouts
  const midT0 = t0?.midPx ?? null;
  const midT1s = t1s?.midPx ?? null;
  const midT10s = t10s?.midPx ?? null;
  const midT60s = t60s?.midPx ?? null;

  const markout1s = midT0 && midT1s ? calculateMarkoutBps(fill.side, fill.fillPx, midT0, midT1s) : null;
  const markout10s = midT0 && midT10s ? calculateMarkoutBps(fill.side, fill.fillPx, midT0, midT10s) : null;
  const markout60s = midT0 && midT60s ? calculateMarkoutBps(fill.side, fill.fillPx, midT0, midT60s) : null;

  // Insert enriched fill
  await db.insert(fillsEnriched).values({
    fillId: fill.id,
    ts: fill.ts,
    exchange: fill.exchange,
    symbol: fill.symbol,
    side: fill.side,
    fillPx: fill.fillPx,
    fillSz: fill.fillSz,
    midT0,
    midT1s,
    midT10s,
    midT60s,
    markout1sBps: markout1s,
    markout10sBps: markout10s,
    markout60sBps: markout60s,
    spreadBpsT0: t0?.spreadBps ?? null,
    state: fill.state,
    paramsSetId: fill.paramsSetId,
  });
}

/**
 * Process unprocessed fills
 */
async function processUnprocessedFills(db: DbType): Promise<number> {
  // Find fills that don't have enriched records yet
  const unprocessed = await db
    .select()
    .from(exFill)
    .leftJoin(fillsEnriched, eq(exFill.id, fillsEnriched.fillId))
    .where(isNull(fillsEnriched.id))
    .limit(100);

  let processed = 0;
  for (const row of unprocessed) {
    try {
      await processFill(db, row.ex_fill);
      processed++;
    } catch (error) {
      logger.error("Failed to process fill", { fillId: row.ex_fill.id, error });
    }
  }

  return processed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregations (Requirement 9.6)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get worst fills by markout (top 5 most negative)
 */
async function getWorstFills(
  db: DbType,
  exchange: string,
  symbol: string,
  windowStart: Date,
  windowEnd: Date,
  limit: number = 5,
): Promise<WorstFill[]> {
  const result = await db
    .select({
      id: fillsEnriched.id,
      ts: fillsEnriched.ts,
      side: fillsEnriched.side,
      fillPx: fillsEnriched.fillPx,
      fillSz: fillsEnriched.fillSz,
      markout10sBps: fillsEnriched.markout10sBps,
    })
    .from(fillsEnriched)
    .where(
      and(
        eq(fillsEnriched.exchange, exchange),
        eq(fillsEnriched.symbol, symbol),
        gte(fillsEnriched.ts, windowStart),
        lte(fillsEnriched.ts, windowEnd),
      ),
    )
    .orderBy(asc(fillsEnriched.markout10sBps)) // Most negative first
    .limit(limit);

  return result.map(row => ({
    fillId: row.id,
    ts: row.ts,
    side: row.side,
    fillPx: row.fillPx,
    fillSz: row.fillSz,
    markout10sBps: row.markout10sBps ? parseFloat(row.markout10sBps) : null,
  }));
}

/**
 * Get aggregation for a time window
 */
async function getAggregation(
  db: DbType,
  exchange: string,
  symbol: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<AggregationResult> {
  // Count fills
  const fillsResult = await db
    .select({ count: count() })
    .from(fillsEnriched)
    .where(
      and(
        eq(fillsEnriched.exchange, exchange),
        eq(fillsEnriched.symbol, symbol),
        gte(fillsEnriched.ts, windowStart),
        lte(fillsEnriched.ts, windowEnd),
      ),
    );
  const fillsCount = fillsResult[0]?.count ?? 0;

  // Count cancels
  const cancelResult = await db
    .select({ count: count() })
    .from(exOrderEvent)
    .where(
      and(
        eq(exOrderEvent.exchange, exchange),
        eq(exOrderEvent.symbol, symbol),
        eq(exOrderEvent.eventType, "cancel"),
        gte(exOrderEvent.ts, windowStart),
        lte(exOrderEvent.ts, windowEnd),
      ),
    );
  const cancelCount = cancelResult[0]?.count ?? 0;

  // Count PAUSE states
  const pauseResult = await db
    .select({ count: count() })
    .from(strategyState)
    .where(
      and(
        eq(strategyState.exchange, exchange),
        eq(strategyState.symbol, symbol),
        eq(strategyState.mode, "PAUSE"),
        gte(strategyState.ts, windowStart),
        lte(strategyState.ts, windowEnd),
      ),
    );
  const pauseCount = pauseResult[0]?.count ?? 0;

  // Get markout percentiles using SQL
  const percentilesResult = await db.execute<{
    p10: string | null;
    p50: string | null;
    p90: string | null;
  }>(sql`
    SELECT
      PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY CAST(markout_10s_bps AS FLOAT)) as p10,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CAST(markout_10s_bps AS FLOAT)) as p50,
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY CAST(markout_10s_bps AS FLOAT)) as p90
    FROM fills_enriched
    WHERE exchange = ${exchange}
      AND symbol = ${symbol}
      AND ts >= ${windowStart}
      AND ts <= ${windowEnd}
      AND markout_10s_bps IS NOT NULL
  `);

  const percentiles = percentilesResult.rows[0];
  const markout10sP10 = percentiles.p10 ? parseFloat(percentiles.p10) : null;
  const markout10sP50 = percentiles.p50 ? parseFloat(percentiles.p50) : null;
  const markout10sP90 = percentiles.p90 ? parseFloat(percentiles.p90) : null;

  // Get worst fills
  const worstFills = await getWorstFills(db, exchange, symbol, windowStart, windowEnd);

  return {
    windowStart,
    windowEnd,
    fillsCount,
    cancelCount,
    pauseCount,
    markout10sP10,
    markout10sP50,
    markout10sP90,
    worstFills,
  };
}

/**
 * Generate 1-minute aggregation for the last complete minute
 */
async function generate1MinAggregation(
  db: DbType,
  exchange: string,
  symbol: string,
): Promise<AggregationResult | null> {
  const now = new Date();
  const windowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0, 0);
  const windowStart = new Date(windowEnd.getTime() - 60_000);

  const agg = await getAggregation(db, exchange, symbol, windowStart, windowEnd);

  if (agg.fillsCount > 0 || agg.cancelCount > 0 || agg.pauseCount > 0) {
    logger.info("1-minute aggregation", {
      window: `${windowStart.toISOString()} - ${windowEnd.toISOString()}`,
      fills: agg.fillsCount,
      cancels: agg.cancelCount,
      pauses: agg.pauseCount,
      markout10sP50: agg.markout10sP50,
    });
    return agg;
  }

  return null;
}

/**
 * Generate 1-hour aggregation for the last complete hour
 */
async function generate1HourAggregation(
  db: DbType,
  exchange: string,
  symbol: string,
): Promise<AggregationResult | null> {
  const now = new Date();
  const windowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
  const windowStart = new Date(windowEnd.getTime() - 3600_000);

  const agg = await getAggregation(db, exchange, symbol, windowStart, windowEnd);

  if (agg.fillsCount > 0 || agg.cancelCount > 0 || agg.pauseCount > 0) {
    logger.info("1-hour aggregation", {
      window: `${windowStart.toISOString()} - ${windowEnd.toISOString()}`,
      fills: agg.fillsCount,
      cancels: agg.cancelCount,
      pauses: agg.pauseCount,
      markout10sP10: agg.markout10sP10,
      markout10sP50: agg.markout10sP50,
      markout10sP90: agg.markout10sP90,
      worstFillsCount: agg.worstFills.length,
    });

    // Log worst fills
    for (const fill of agg.worstFills) {
      logger.info("Worst fill", {
        fillId: fill.fillId,
        side: fill.side,
        markout10sBps: fill.markout10sBps,
      });
    }

    return agg;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info("Starting summarizer");

  const db = getDb(env.DATABASE_URL);

  let lastMinuteAgg = 0;
  let lastHourAgg = 0;

  const runOnce = async (): Promise<void> => {
    // Process fills
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

  // Run immediately
  await runOnce();

  // Run periodically
  const interval = setInterval(() => {
    void runOnce();
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

  logger.info("Summarizer running");
}

main().catch(error => {
  logger.error("Fatal error", error);
  process.exit(1);
});
