/**
 * BBO/Price Lookup Service
 *
 * Requirements: 9.2
 * - Reference price is mid
 * - Find closest BBO/Price to a given timestamp
 */

import { eq, and, gte, lte, sql } from "drizzle-orm";
import { mdBbo, mdPrice } from "@agentic-mm-bot/db";
import type { Db } from "@agentic-mm-bot/db";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BBO reference data
 */
export interface BboRef {
  midPx: string;
  spreadBps: string;
  bestBidPx: string;
  bestAskPx: string;
  ts: Date;
}

/**
 * Price reference data (mark/index)
 */
export interface PriceRef {
  markPx: string | null;
  indexPx: string | null;
  ts: Date;
}

/**
 * Tolerance windows for BBO lookups (in ms)
 */
export const BBO_TOLERANCE = {
  t0: 500,
  t1s: 500,
  t10s: 1000,
  t60s: 5000,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// BBO Lookup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find closest BBO to a timestamp using safe SQL
 *
 * Strategy: Query records in tolerance window, then sort by absolute time diff.
 * Uses EXTRACT(EPOCH) for portable timestamp diff calculation.
 */
export async function findClosestBbo(
  db: Db,
  exchange: string,
  symbol: string,
  targetTs: Date,
  toleranceMs: number = 1000,
): Promise<BboRef | null> {
  const minTs = new Date(targetTs.getTime() - toleranceMs);
  const maxTs = new Date(targetTs.getTime() + toleranceMs);
  const targetEpoch = targetTs.getTime() / 1000;

  const result = await db
    .select({
      midPx: mdBbo.midPx,
      bestBidPx: mdBbo.bestBidPx,
      bestAskPx: mdBbo.bestAskPx,
      ts: mdBbo.ts,
    })
    .from(mdBbo)
    .where(and(eq(mdBbo.exchange, exchange), eq(mdBbo.symbol, symbol), gte(mdBbo.ts, minTs), lte(mdBbo.ts, maxTs)))
    .orderBy(sql`ABS(EXTRACT(EPOCH FROM ${mdBbo.ts}) - ${targetEpoch})`)
    .limit(1);

  if (result.length === 0) return null;

  const row = result[0];
  const mid = Number.parseFloat(row.midPx);
  const bid = Number.parseFloat(row.bestBidPx);
  const ask = Number.parseFloat(row.bestAskPx);
  const spreadBps = mid > 0 ? ((ask - bid) / mid) * 10_000 : 0;

  return {
    midPx: row.midPx,
    bestBidPx: row.bestBidPx,
    bestAskPx: row.bestAskPx,
    spreadBps: spreadBps.toFixed(4),
    ts: row.ts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Price (Mark/Index) Lookup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find closest md_price to a timestamp
 */
export async function findClosestPrice(
  db: Db,
  exchange: string,
  symbol: string,
  targetTs: Date,
  toleranceMs: number = 1000,
): Promise<PriceRef | null> {
  const minTs = new Date(targetTs.getTime() - toleranceMs);
  const maxTs = new Date(targetTs.getTime() + toleranceMs);
  const targetEpoch = targetTs.getTime() / 1000;

  const result = await db
    .select({
      markPx: mdPrice.markPx,
      indexPx: mdPrice.indexPx,
      ts: mdPrice.ts,
    })
    .from(mdPrice)
    .where(
      and(eq(mdPrice.exchange, exchange), eq(mdPrice.symbol, symbol), gte(mdPrice.ts, minTs), lte(mdPrice.ts, maxTs)),
    )
    .orderBy(sql`ABS(EXTRACT(EPOCH FROM ${mdPrice.ts}) - ${targetEpoch})`)
    .limit(1);

  if (result.length === 0) return null;

  const row = result[0];
  return {
    markPx: row.markPx,
    indexPx: row.indexPx,
    ts: row.ts,
  };
}
