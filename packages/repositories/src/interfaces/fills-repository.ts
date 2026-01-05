/**
 * Fills Repository Interface
 *
 * Requirements: 9.1, 9.3, 9.4, 9.5
 * - Query unprocessed fills (ex_fill without fills_enriched)
 * - Insert enriched fills with markout and features
 */

import type { ResultAsync } from "neverthrow";
import type { ExFill } from "@agentic-mm-bot/db";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type FillsRepositoryError =
  | { type: "DB_ERROR"; message: string }
  | { type: "NOT_FOUND"; message: string };

/**
 * Enriched fill record for insert
 */
export interface EnrichedFillInsert {
  fillId: string;
  ts: Date;
  exchange: string;
  symbol: string;
  side: string;
  fillPx: string;
  fillSz: string;
  midT0?: string | null;
  midT1s?: string | null;
  midT10s?: string | null;
  midT60s?: string | null;
  markout1sBps?: string | null;
  markout10sBps?: string | null;
  markout60sBps?: string | null;
  spreadBpsT0?: string | null;
  tradeImbalance1sT0?: string | null;
  realizedVol10sT0?: string | null;
  markIndexDivBpsT0?: string | null;
  liqCount10sT0?: number | null;
  /** Required by schema */
  state: string;
  /** Required by schema */
  paramsSetId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interface
// ─────────────────────────────────────────────────────────────────────────────

export interface FillsRepository {
  /**
   * Get unprocessed fills (fills without enriched records)
   *
   * Only returns fills older than horizonCutoff to ensure
   * all markout horizons (1s, 10s, 60s) have data available.
   */
  getUnprocessedFills(
    horizonCutoff: Date,
    limit: number,
  ): ResultAsync<ExFill[], FillsRepositoryError>;

  /**
   * Insert an enriched fill record
   */
  insertEnrichedFill(
    fill: EnrichedFillInsert,
  ): ResultAsync<void, FillsRepositoryError>;

  /**
   * Batch insert enriched fill records
   */
  insertEnrichedFillBatch(
    fills: EnrichedFillInsert[],
  ): ResultAsync<void, FillsRepositoryError>;
}
