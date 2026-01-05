/**
 * Postgres Fills Repository
 *
 * Requirements: 9.1, 9.3, 9.4, 9.5
 * - Query unprocessed fills
 * - Insert enriched fills with markout and features
 */

import { eq, and, lte, isNull } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import { exFill, fillsEnriched, type Db, type ExFill } from "@agentic-mm-bot/db";

import type { FillsRepository, FillsRepositoryError, EnrichedFillInsert } from "../interfaces/fills-repository";

/**
 * Create a Postgres fills repository
 */
export function createPostgresFillsRepository(db: Db): FillsRepository {
  return {
    getUnprocessedFills(horizonCutoff: Date, limit: number): ResultAsync<ExFill[], FillsRepositoryError> {
      return ResultAsync.fromPromise(
        db
          .select({
            ex_fill: exFill,
          })
          .from(exFill)
          .leftJoin(fillsEnriched, eq(exFill.id, fillsEnriched.fillId))
          .where(and(isNull(fillsEnriched.id), lte(exFill.ts, horizonCutoff)))
          .limit(limit)
          .then(rows => rows.map(row => row.ex_fill)),
        e => ({
          type: "DB_ERROR" as const,
          message: e instanceof Error ? e.message : "Unknown error",
        }),
      );
    },

    insertEnrichedFill(fill: EnrichedFillInsert): ResultAsync<void, FillsRepositoryError> {
      return ResultAsync.fromPromise(
        db.insert(fillsEnriched).values({
          fillId: fill.fillId,
          ts: fill.ts,
          exchange: fill.exchange,
          symbol: fill.symbol,
          side: fill.side,
          fillPx: fill.fillPx,
          fillSz: fill.fillSz,
          midT0: fill.midT0 ?? undefined,
          midT1s: fill.midT1s ?? undefined,
          midT10s: fill.midT10s ?? undefined,
          midT60s: fill.midT60s ?? undefined,
          markout1sBps: fill.markout1sBps ?? undefined,
          markout10sBps: fill.markout10sBps ?? undefined,
          markout60sBps: fill.markout60sBps ?? undefined,
          spreadBpsT0: fill.spreadBpsT0 ?? undefined,
          tradeImbalance1sT0: fill.tradeImbalance1sT0 ?? undefined,
          realizedVol10sT0: fill.realizedVol10sT0 ?? undefined,
          markIndexDivBpsT0: fill.markIndexDivBpsT0 ?? undefined,
          liqCount10sT0: fill.liqCount10sT0 ?? undefined,
          state: fill.state,
          paramsSetId: fill.paramsSetId,
        }),
        e => ({
          type: "DB_ERROR" as const,
          message: e instanceof Error ? e.message : "Unknown error",
        }),
      ).map(() => undefined);
    },

    insertEnrichedFillBatch(fills: EnrichedFillInsert[]): ResultAsync<void, FillsRepositoryError> {
      if (fills.length === 0) {
        return ResultAsync.fromSafePromise(Promise.resolve(undefined));
      }

      return ResultAsync.fromPromise(
        db.insert(fillsEnriched).values(
          fills.map(fill => ({
            fillId: fill.fillId,
            ts: fill.ts,
            exchange: fill.exchange,
            symbol: fill.symbol,
            side: fill.side,
            fillPx: fill.fillPx,
            fillSz: fill.fillSz,
            midT0: fill.midT0 ?? undefined,
            midT1s: fill.midT1s ?? undefined,
            midT10s: fill.midT10s ?? undefined,
            midT60s: fill.midT60s ?? undefined,
            markout1sBps: fill.markout1sBps ?? undefined,
            markout10sBps: fill.markout10sBps ?? undefined,
            markout60sBps: fill.markout60sBps ?? undefined,
            spreadBpsT0: fill.spreadBpsT0 ?? undefined,
            tradeImbalance1sT0: fill.tradeImbalance1sT0 ?? undefined,
            realizedVol10sT0: fill.realizedVol10sT0 ?? undefined,
            markIndexDivBpsT0: fill.markIndexDivBpsT0 ?? undefined,
            liqCount10sT0: fill.liqCount10sT0 ?? undefined,
            state: fill.state,
            paramsSetId: fill.paramsSetId,
          })),
        ),
        e => ({
          type: "DB_ERROR" as const,
          message: e instanceof Error ? e.message : "Unknown error",
        }),
      ).map(() => undefined);
    },
  };
}
