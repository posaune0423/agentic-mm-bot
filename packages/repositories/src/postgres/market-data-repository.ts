/**
 * Postgres Market Data Repository
 *
 * Requirements: 3.2, 9.2, 11.1
 * - Batch insert market data
 * - Lookup reference prices
 * - Load historical data for backtest
 */

import { eq, and, gte, lte, asc, sql } from "drizzle-orm";
import { ok, err, ResultAsync } from "neverthrow";
import type { Result } from "neverthrow";
import { mdBbo, mdTrade, mdPrice, latestTop } from "@agentic-mm-bot/db";
import type { Db, MdBbo, MdTrade } from "@agentic-mm-bot/db";

import type {
  MarketDataRepository,
  MarketDataRepositoryError,
  BboInsert,
  TradeInsert,
  PriceInsert,
  LatestTopState,
  BboRef,
  PriceRef,
  MarketDataArrays,
} from "../interfaces/market-data-repository";

/**
 * Create a Postgres market data repository
 */
export function createPostgresMarketDataRepository(db: Db): MarketDataRepository {
  return {
    // ─────────────────────────────────────────────────────────────────────────────
    // Batch Insert
    // ─────────────────────────────────────────────────────────────────────────────

    insertBboBatch(records: BboInsert[]): ResultAsync<void, MarketDataRepositoryError> {
      if (records.length === 0) {
        return ResultAsync.fromSafePromise(Promise.resolve(undefined));
      }

      return ResultAsync.fromPromise(db.insert(mdBbo).values(records), e => ({
        type: "DB_ERROR" as const,
        message: e instanceof Error ? e.message : "Unknown error",
      })).map(() => undefined);
    },

    insertTradeBatch(records: TradeInsert[]): ResultAsync<void, MarketDataRepositoryError> {
      if (records.length === 0) {
        return ResultAsync.fromSafePromise(Promise.resolve(undefined));
      }

      return ResultAsync.fromPromise(db.insert(mdTrade).values(records), e => ({
        type: "DB_ERROR" as const,
        message: e instanceof Error ? e.message : "Unknown error",
      })).map(() => undefined);
    },

    insertPriceBatch(records: PriceInsert[]): ResultAsync<void, MarketDataRepositoryError> {
      if (records.length === 0) {
        return ResultAsync.fromSafePromise(Promise.resolve(undefined));
      }

      return ResultAsync.fromPromise(db.insert(mdPrice).values(records), e => ({
        type: "DB_ERROR" as const,
        message: e instanceof Error ? e.message : "Unknown error",
      })).map(() => undefined);
    },

    upsertLatestTop(state: LatestTopState): ResultAsync<void, MarketDataRepositoryError> {
      return ResultAsync.fromPromise(
        db
          .insert(latestTop)
          .values({
            exchange: state.exchange,
            symbol: state.symbol,
            ts: state.ts,
            bestBidPx: state.bestBidPx,
            bestBidSz: state.bestBidSz,
            bestAskPx: state.bestAskPx,
            bestAskSz: state.bestAskSz,
            midPx: state.midPx,
            markPx: state.markPx,
            indexPx: state.indexPx,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [latestTop.exchange, latestTop.symbol],
            set: {
              ts: state.ts,
              bestBidPx: state.bestBidPx,
              bestBidSz: state.bestBidSz,
              bestAskPx: state.bestAskPx,
              bestAskSz: state.bestAskSz,
              midPx: state.midPx,
              markPx: state.markPx,
              indexPx: state.indexPx,
              updatedAt: new Date(),
            },
          }),
        e => ({
          type: "DB_ERROR" as const,
          message: e instanceof Error ? e.message : "Unknown error",
        }),
      ).map(() => undefined);
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // Lookup
    // ─────────────────────────────────────────────────────────────────────────────

    async findClosestBbo(
      exchange: string,
      symbol: string,
      targetTs: Date,
      toleranceMs: number,
    ): Promise<Result<BboRef | null, MarketDataRepositoryError>> {
      try {
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
          .where(
            and(eq(mdBbo.exchange, exchange), eq(mdBbo.symbol, symbol), gte(mdBbo.ts, minTs), lte(mdBbo.ts, maxTs)),
          )
          .orderBy(sql`ABS(EXTRACT(EPOCH FROM ${mdBbo.ts}) - ${targetEpoch})`)
          .limit(1);

        if (result.length === 0) return ok(null);

        const row = result[0];
        const mid = Number.parseFloat(row.midPx);
        const bid = Number.parseFloat(row.bestBidPx);
        const ask = Number.parseFloat(row.bestAskPx);
        const spreadBps = mid > 0 ? ((ask - bid) / mid) * 10_000 : 0;

        return ok({
          midPx: row.midPx,
          bestBidPx: row.bestBidPx,
          bestAskPx: row.bestAskPx,
          spreadBps: spreadBps.toFixed(4),
          ts: row.ts,
        });
      } catch (error) {
        return err({
          type: "DB_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },

    async findClosestPrice(
      exchange: string,
      symbol: string,
      targetTs: Date,
      toleranceMs: number,
    ): Promise<Result<PriceRef | null, MarketDataRepositoryError>> {
      try {
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
            and(
              eq(mdPrice.exchange, exchange),
              eq(mdPrice.symbol, symbol),
              gte(mdPrice.ts, minTs),
              lte(mdPrice.ts, maxTs),
            ),
          )
          .orderBy(sql`ABS(EXTRACT(EPOCH FROM ${mdPrice.ts}) - ${targetEpoch})`)
          .limit(1);

        if (result.length === 0) return ok(null);

        const row = result[0];
        return ok({
          markPx: row.markPx,
          indexPx: row.indexPx,
          ts: row.ts,
        });
      } catch (error) {
        return err({
          type: "DB_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // Window Queries
    // ─────────────────────────────────────────────────────────────────────────────

    getTradesInWindow(
      exchange: string,
      symbol: string,
      windowStart: Date,
      windowEnd: Date,
    ): ResultAsync<MdTrade[], MarketDataRepositoryError> {
      return ResultAsync.fromPromise(
        db
          .select()
          .from(mdTrade)
          .where(
            and(
              eq(mdTrade.exchange, exchange),
              eq(mdTrade.symbol, symbol),
              gte(mdTrade.ts, windowStart),
              lte(mdTrade.ts, windowEnd),
            ),
          )
          .orderBy(asc(mdTrade.ts)),
        e => ({
          type: "DB_ERROR" as const,
          message: e instanceof Error ? e.message : "Unknown error",
        }),
      );
    },

    getBbosInWindow(
      exchange: string,
      symbol: string,
      windowStart: Date,
      windowEnd: Date,
      limit: number = 2000,
    ): ResultAsync<MdBbo[], MarketDataRepositoryError> {
      return ResultAsync.fromPromise(
        db
          .select()
          .from(mdBbo)
          .where(
            and(
              eq(mdBbo.exchange, exchange),
              eq(mdBbo.symbol, symbol),
              gte(mdBbo.ts, windowStart),
              lte(mdBbo.ts, windowEnd),
            ),
          )
          .orderBy(asc(mdBbo.ts))
          .limit(limit),
        e => ({
          type: "DB_ERROR" as const,
          message: e instanceof Error ? e.message : "Unknown error",
        }),
      );
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // Bulk Load (Backtest)
    // ─────────────────────────────────────────────────────────────────────────────

    loadMarketData(
      exchange: string,
      symbol: string,
      startTime: Date,
      endTime: Date,
    ): ResultAsync<MarketDataArrays, MarketDataRepositoryError> {
      return ResultAsync.fromPromise(
        Promise.all([
          db
            .select()
            .from(mdBbo)
            .where(
              and(
                eq(mdBbo.exchange, exchange),
                eq(mdBbo.symbol, symbol),
                gte(mdBbo.ts, startTime),
                lte(mdBbo.ts, endTime),
              ),
            )
            .orderBy(asc(mdBbo.ts)),

          db
            .select()
            .from(mdTrade)
            .where(
              and(
                eq(mdTrade.exchange, exchange),
                eq(mdTrade.symbol, symbol),
                gte(mdTrade.ts, startTime),
                lte(mdTrade.ts, endTime),
              ),
            )
            .orderBy(asc(mdTrade.ts)),

          db
            .select()
            .from(mdPrice)
            .where(
              and(
                eq(mdPrice.exchange, exchange),
                eq(mdPrice.symbol, symbol),
                gte(mdPrice.ts, startTime),
                lte(mdPrice.ts, endTime),
              ),
            )
            .orderBy(asc(mdPrice.ts)),
        ]),
        e => ({
          type: "DB_ERROR" as const,
          message: e instanceof Error ? e.message : "Unknown error",
        }),
      ).map(([bboData, tradeData, priceData]) => ({
        bboData,
        tradeData,
        priceData,
      }));
    },
  };
}
