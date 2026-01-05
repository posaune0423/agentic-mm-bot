/**
 * Process Fills Usecase
 *
 * Requirements: 9.1-9.5
 * - Generate fills_enriched from ex_fill
 * - Calculate markout at 1s/10s/60s
 * - Calculate features at fill time
 * - Horizon gate: only process fills older than 60s
 */

import { eq, and, lte, isNull } from "drizzle-orm";
import {
  exFill,
  fillsEnriched,
  type Db,
  type ExFill,
} from "@agentic-mm-bot/db";
import { logger } from "@agentic-mm-bot/utils";

import {
  findClosestBbo,
  findClosestPrice,
  BBO_TOLERANCE,
  calculateAllMarkouts,
  calculateAllFeatures,
} from "../services";

/** Maximum horizon for markout calculation (60s) */
const MAX_HORIZON_MS = 60_000;

// ─────────────────────────────────────────────────────────────────────────────
// Fill Processing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process a single fill - calculate markouts and features
 */
async function processFill(db: Db, fill: ExFill): Promise<void> {
  // Get reference prices at different time horizons
  const bboT0 = await findClosestBbo(
    db,
    fill.exchange,
    fill.symbol,
    fill.ts,
    BBO_TOLERANCE.t0,
  );
  const bboT1s = await findClosestBbo(
    db,
    fill.exchange,
    fill.symbol,
    new Date(fill.ts.getTime() + 1000),
    BBO_TOLERANCE.t1s,
  );
  const bboT10s = await findClosestBbo(
    db,
    fill.exchange,
    fill.symbol,
    new Date(fill.ts.getTime() + 10_000),
    BBO_TOLERANCE.t10s,
  );
  const bboT60s = await findClosestBbo(
    db,
    fill.exchange,
    fill.symbol,
    new Date(fill.ts.getTime() + 60_000),
    BBO_TOLERANCE.t60s,
  );

  // Get mark/index price for divergence calculation
  const priceT0 = await findClosestPrice(
    db,
    fill.exchange,
    fill.symbol,
    fill.ts,
    BBO_TOLERANCE.t0,
  );

  // Extract mid prices
  const midT0 = bboT0?.midPx ?? null;
  const midT1s = bboT1s?.midPx ?? null;
  const midT10s = bboT10s?.midPx ?? null;
  const midT60s = bboT60s?.midPx ?? null;

  // Calculate markouts
  const markouts = calculateAllMarkouts(
    fill.side,
    fill.fillPx,
    midT0,
    midT1s,
    midT10s,
    midT60s,
  );

  // Calculate features (Requirement 9.5)
  const features = await calculateAllFeatures(
    db,
    fill.exchange,
    fill.symbol,
    fill.ts,
    midT0,
    priceT0?.markPx ?? null,
    priceT0?.indexPx ?? null,
  );

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
    markout1sBps: markouts.markout1sBps,
    markout10sBps: markouts.markout10sBps,
    markout60sBps: markouts.markout60sBps,
    spreadBpsT0: bboT0?.spreadBps ?? null,
    tradeImbalance1sT0: features.tradeImbalance1sT0,
    realizedVol10sT0: features.realizedVol10sT0,
    markIndexDivBpsT0: features.markIndexDivBpsT0,
    liqCount10sT0: features.liqCount10sT0,
    state: fill.state,
    paramsSetId: fill.paramsSetId,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Usecase
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process unprocessed fills
 *
 * Horizon gate: Only process fills where ts <= now - 60s
 * This ensures all markout horizons (1s, 10s, 60s) have data available.
 */
export async function processUnprocessedFills(db: Db): Promise<number> {
  const horizonCutoff = new Date(Date.now() - MAX_HORIZON_MS);

  // Find fills that:
  // 1. Don't have enriched records yet
  // 2. Are old enough for all markout horizons to be available
  const unprocessed = await db
    .select()
    .from(exFill)
    .leftJoin(fillsEnriched, eq(exFill.id, fillsEnriched.fillId))
    .where(and(isNull(fillsEnriched.id), lte(exFill.ts, horizonCutoff)))
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
