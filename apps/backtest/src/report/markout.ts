/**
 * Markout Calculator - Calculate pseudo-markout for backtest fills
 *
 * Requirements: 11.4
 * - Calculate markout based on mid price at fill time and t+10s
 * - Use same sign convention as summarizer
 */

import type { MdBbo } from "@agentic-mm-bot/db";
import type { Side } from "@agentic-mm-bot/core";
import type { SimFill } from "../sim/sim-execution";

const MARKOUT_WINDOW_MS = 10_000; // 10 seconds

/**
 * Enriched fill with markout
 */
export interface EnrichedFill {
  ts: Date;
  side: Side;
  orderPx: string;
  size: string;
  midT0: string;
  midT10s: string | null;
  markout10sBps: number | null;
  mode: string;
  reasonCodes: string;
}

/**
 * Find the closest BBO record at or before a given time
 */
function findBboBeforeTime(bboData: MdBbo[], targetMs: number): MdBbo | null {
  let left = 0;
  let right = bboData.length - 1;
  let result: MdBbo | null = null;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const bboTs = bboData[mid].ts.getTime();

    if (bboTs <= targetMs) {
      result = bboData[mid];
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return result;
}

/**
 * Calculate markout in bps
 *
 * Sign convention (same as summarizer):
 * - BUY: (mid_t10 - mid_t0) / mid_t0 * 10000
 * - SELL: (mid_t0 - mid_t10) / mid_t0 * 10000
 *
 * Positive markout = profitable (price moved in our favor)
 */
function calculateMarkoutBps(side: Side, midT0: number, midT10s: number): number {
  if (midT0 === 0) return 0;

  const priceDiff = side === "buy" ? midT10s - midT0 : midT0 - midT10s;
  return (priceDiff / midT0) * 10_000;
}

/**
 * Enrich fills with markout calculations
 *
 * @param fills - Simulated fills
 * @param bboData - BBO data sorted by ts ascending
 * @returns Enriched fills with markout
 */
export function enrichFillsWithMarkout(fills: SimFill[], bboData: MdBbo[]): EnrichedFill[] {
  const enrichedFills: EnrichedFill[] = [];

  for (const fill of fills) {
    const fillMs = fill.ts.getTime();
    const midT0 = Number.parseFloat(fill.midT0);

    // Find BBO at t+10s
    const targetMs = fillMs + MARKOUT_WINDOW_MS;
    const bboT10s = findBboBeforeTime(bboData, targetMs);

    let midT10s: string | null = null;
    let markout10sBps: number | null = null;

    if (bboT10s && bboT10s.ts.getTime() >= fillMs) {
      midT10s = bboT10s.midPx;
      markout10sBps = calculateMarkoutBps(fill.side, midT0, Number.parseFloat(midT10s));
    }

    enrichedFills.push({
      ts: fill.ts,
      side: fill.side,
      orderPx: fill.orderPx,
      size: fill.size,
      midT0: fill.midT0,
      midT10s,
      markout10sBps,
      mode: fill.mode,
      reasonCodes: fill.reasonCodes.join(";"),
    });
  }

  return enrichedFills;
}

/**
 * Calculate average markout from enriched fills
 */
export function calculateAverageMarkout(fills: EnrichedFill[]): number | null {
  const validMarkouts = fills.filter(f => f.markout10sBps !== null).map(f => f.markout10sBps as number);

  if (validMarkouts.length === 0) {
    return null;
  }

  const sum = validMarkouts.reduce((a, b) => a + b, 0);
  return sum / validMarkouts.length;
}
