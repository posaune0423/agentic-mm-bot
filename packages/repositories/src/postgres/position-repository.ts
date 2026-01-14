/**
 * Postgres Position Repository
 *
 * Requirements: 4.4, 12.4
 * - Upsert latest_position per (exchange, symbol)
 */

import { ResultAsync } from "neverthrow";
import { latestPosition, type Db } from "@agentic-mm-bot/db";

import type {
  PositionRepository,
  PositionRepositoryError,
  LatestPositionState,
} from "../interfaces/position-repository";

/**
 * Create a Postgres position repository
 */
export function createPostgresPositionRepository(db: Db): PositionRepository {
  return {
    upsertLatestPosition(state: LatestPositionState): ResultAsync<void, PositionRepositoryError> {
      return ResultAsync.fromPromise(
        db
          .insert(latestPosition)
          .values({
            exchange: state.exchange,
            symbol: state.symbol,
            ts: state.ts,
            positionSz: state.positionSz,
            entryPx: state.entryPx ?? null,
            unrealizedPnl: state.unrealizedPnl ?? null,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [latestPosition.exchange, latestPosition.symbol],
            set: {
              ts: state.ts,
              positionSz: state.positionSz,
              entryPx: state.entryPx ?? null,
              unrealizedPnl: state.unrealizedPnl ?? null,
              updatedAt: new Date(),
            },
          }),
        e => ({
          type: "DB_ERROR" as const,
          message: e instanceof Error ? e.message : "Unknown error",
        }),
      ).map(() => undefined);
    },
  };
}
