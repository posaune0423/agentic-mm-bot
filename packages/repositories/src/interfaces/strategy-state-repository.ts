/**
 * Strategy State Repository Interface
 *
 * Requirements: 4.11, 12.4
 * - Periodic snapshots for recovery
 * - Read latest snapshot on startup
 */

import type { Result } from "neverthrow";
import type { StrategyMode } from "@agentic-mm-bot/core";

/**
 * Strategy state snapshot for persistence
 */
export interface StrategyStateSnapshot {
  id?: string;
  ts: Date;
  exchange: string;
  symbol: string;
  mode: StrategyMode;
  modeSince: Date | null;
  pauseUntil: Date | null;
  paramsSetId: string | null;
  createdAt?: Date;
}

/**
 * Repository error types
 */
export type StrategyStateRepositoryError =
  | { type: "DB_ERROR"; message: string }
  | { type: "NOT_FOUND"; message: string };

/**
 * Strategy State Repository Interface
 *
 * Provides data access for strategy state snapshots used for recovery.
 */
export interface StrategyStateRepository {
  /**
   * Save a new strategy state snapshot
   */
  save: (snapshot: StrategyStateSnapshot) => Promise<Result<void, StrategyStateRepositoryError>>;

  /**
   * Get the latest strategy state snapshot for a symbol
   */
  getLatest: (
    exchange: string,
    symbol: string,
  ) => Promise<Result<StrategyStateSnapshot | null, StrategyStateRepositoryError>>;
}
