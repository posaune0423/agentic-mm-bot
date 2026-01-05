/**
 * Markout Calculator Service
 *
 * Requirements: 9.4
 * - Calculate markout in bps with consistent sign for BUY/SELL
 * - BUY: positive markout = price went up (good)
 * - SELL: positive markout = price went down (good)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Markout Calculation (Pure Function)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate markout in bps
 *
 * For BUY: markout = (mid_t1 - fill_px) / mid_t0 * 10000
 * For SELL: markout = (fill_px - mid_t1) / mid_t0 * 10000
 *
 * @param side - 'buy' or 'sell'
 * @param fillPx - Fill price as string
 * @param midT0 - Mid price at fill time
 * @param midT1 - Mid price at horizon time
 * @returns Markout in bps as string, or null if calculation not possible
 */
export function calculateMarkoutBps(side: string, fillPx: string, midT0: string, midT1: string | null): string | null {
  if (!midT1) return null;

  const fill = parseFloat(fillPx);
  const t0 = parseFloat(midT0);
  const t1 = parseFloat(midT1);

  if (t0 === 0) return null;

  const markout = side === "buy" ? ((t1 - fill) / t0) * 10_000 : ((fill - t1) / t0) * 10_000;

  return markout.toFixed(4);
}

/**
 * Calculate all markouts for a fill
 */
export interface MarkoutResult {
  markout1sBps: string | null;
  markout10sBps: string | null;
  markout60sBps: string | null;
}

export function calculateAllMarkouts(
  side: string,
  fillPx: string,
  midT0: string | null,
  midT1s: string | null,
  midT10s: string | null,
  midT60s: string | null,
): MarkoutResult {
  return {
    markout1sBps: midT0 && midT1s ? calculateMarkoutBps(side, fillPx, midT0, midT1s) : null,
    markout10sBps: midT0 && midT10s ? calculateMarkoutBps(side, fillPx, midT0, midT10s) : null,
    markout60sBps: midT0 && midT60s ? calculateMarkoutBps(side, fillPx, midT0, midT60s) : null,
  };
}
