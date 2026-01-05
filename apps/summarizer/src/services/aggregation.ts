/**
 * Aggregation Service
 *
 * Requirements: 9.6
 * - Generate 1-minute and 1-hour aggregations
 * - Worst fills extraction (top 5 by markout)
 * - Percentile calculations for markout
 */

import { eq, and, gte, lte, sql, asc, count } from "drizzle-orm";
import { fillsEnriched, exOrderEvent, strategyState, type Db } from "@agentic-mm-bot/db";
import { logger } from "@agentic-mm-bot/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aggregation result for a time window
 */
export interface AggregationResult {
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
export interface WorstFill {
  fillId: string;
  ts: Date;
  side: string;
  fillPx: string;
  fillSz: string;
  markout10sBps: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Worst Fills
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get worst fills by markout (top 5 most negative)
 *
 * Returns fill_id (ex_fill.id reference) not fills_enriched.id
 */
export async function getWorstFills(
  db: Db,
  exchange: string,
  symbol: string,
  windowStart: Date,
  windowEnd: Date,
  limit: number = 5,
): Promise<WorstFill[]> {
  const result = await db
    .select({
      fillId: fillsEnriched.fillId, // Use fill_id (FK to ex_fill.id)
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
    fillId: row.fillId, // Now correctly returns ex_fill.id reference
    ts: row.ts,
    side: row.side,
    fillPx: row.fillPx,
    fillSz: row.fillSz,
    markout10sBps: row.markout10sBps ? parseFloat(row.markout10sBps) : null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get aggregation for a time window
 */
export async function getAggregation(
  db: Db,
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

  // Count PAUSE states (snapshots with mode=PAUSE)
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
  const p10 = percentiles.p10;
  const p50 = percentiles.p50;
  const p90 = percentiles.p90;
  const markout10sP10 = p10 ? parseFloat(p10) : null;
  const markout10sP50 = p50 ? parseFloat(p50) : null;
  const markout10sP90 = p90 ? parseFloat(p90) : null;

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

// ─────────────────────────────────────────────────────────────────────────────
// Periodic Aggregation Generators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate 1-minute aggregation for the last complete minute
 */
export async function generate1MinAggregation(
  db: Db,
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
export async function generate1HourAggregation(
  db: Db,
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
