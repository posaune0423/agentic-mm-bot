/**
 * Repository Types
 *
 * Types shared across repositories (e.g., for metrics aggregation)
 */

/**
 * Worst fill entry for LLM context
 */
export interface WorstFillSummary {
  fillId: string;
  ts: Date;
  side: string;
  fillPx: string;
  fillSz: string;
  markout10sBps: number | null;
}

/**
 * Hourly aggregation for LLM input
 */
export interface HourlyAggregation {
  windowStart: Date;
  windowEnd: Date;
  fillsCount: number;
  cancelCount: number;
  pauseCount: number;
  markout10sP10: number | null;
  markout10sP50: number | null;
  markout10sP90: number | null;
  worstFills: WorstFillSummary[];
}

/**
 * Current parameters for LLM input
 */
export interface CurrentParamsSummary {
  paramsSetId: string;
  baseHalfSpreadBps: string;
  volSpreadGain: string;
  toxSpreadGain: string;
  quoteSizeUsd: string;
  refreshIntervalMs: number;
  staleCancelMs: number;
  maxInventory: string;
  inventorySkewGain: string;
  pauseMarkIndexBps: string;
  pauseLiqCount10s: number;
}
