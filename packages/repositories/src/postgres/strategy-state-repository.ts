/**
 * Postgres Strategy State Repository
 *
 * Requirements: 4.11, 12.4
 * - Periodic snapshots for recovery
 * - Read latest snapshot on startup
 */

import { desc, eq, and } from "drizzle-orm";
import { ok, err, type Result } from "neverthrow";
import { strategyState, type Db } from "@agentic-mm-bot/db";
import type { StrategyMode } from "@agentic-mm-bot/core";

import type {
  StrategyStateRepository,
  StrategyStateSnapshot,
  StrategyStateRepositoryError,
} from "../interfaces/strategy-state-repository";

/**
 * Create a Postgres strategy state repository
 */
export function createPostgresStrategyStateRepository(db: Db): StrategyStateRepository {
  return {
    async save(snapshot: StrategyStateSnapshot): Promise<Result<void, StrategyStateRepositoryError>> {
      try {
        await db.insert(strategyState).values({
          ts: snapshot.ts,
          exchange: snapshot.exchange,
          symbol: snapshot.symbol,
          mode: snapshot.mode,
          modeSince: snapshot.modeSince,
          pauseUntil: snapshot.pauseUntil,
          paramsSetId: snapshot.paramsSetId,
        });
        return ok(undefined);
      } catch (error) {
        return err({
          type: "DB_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },

    async getLatest(
      exchange: string,
      symbol: string,
    ): Promise<Result<StrategyStateSnapshot | null, StrategyStateRepositoryError>> {
      try {
        const result = await db
          .select()
          .from(strategyState)
          .where(and(eq(strategyState.exchange, exchange), eq(strategyState.symbol, symbol)))
          .orderBy(desc(strategyState.ts))
          .limit(1);

        if (result.length === 0) {
          return ok(null);
        }

        const row = result[0];
        return ok({
          id: row.id,
          ts: row.ts,
          exchange: row.exchange,
          symbol: row.symbol,
          mode: row.mode as StrategyMode,
          modeSince: row.modeSince,
          pauseUntil: row.pauseUntil,
          paramsSetId: row.paramsSetId,
          createdAt: row.createdAt,
        });
      } catch (error) {
        return err({
          type: "DB_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  };
}
