/**
 * Position Repository Interface
 *
 * Requirements: 4.4, 12.4
 * - Maintain latest_position (1 row per (exchange, symbol))
 */

import type { ResultAsync } from "neverthrow";

export type PositionRepositoryError = {
  type: "DB_ERROR";
  message: string;
};

export interface LatestPositionState {
  exchange: string;
  symbol: string;
  ts: Date;
  /** numeric columns are represented as strings in drizzle */
  positionSz: string;
  entryPx?: string | null;
  unrealizedPnl?: string | null;
}

export interface PositionRepository {
  upsertLatestPosition(state: LatestPositionState): ResultAsync<void, PositionRepositoryError>;
}
