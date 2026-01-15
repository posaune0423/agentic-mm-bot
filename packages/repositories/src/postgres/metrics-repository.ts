/**
 * Postgres Metrics Repository
 *
 * Requirements: 10.1, 9.6
 * - Aggregation queries for LLM reflection
 */

import { eq, and, gte, lte, asc, count, sql } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import { fillsEnriched, exOrderEvent, strategyState, strategyParams } from "@agentic-mm-bot/db";
import type { Db } from "@agentic-mm-bot/db";
import { logger } from "@agentic-mm-bot/utils";

import type { MetricsRepository, MetricsRepositoryError } from "../interfaces/metrics-repository";
import type { HourlyAggregation, CurrentParamsSummary, WorstFillSummary } from "../types";

export function createPostgresMetricsRepository(db: Db): MetricsRepository {
  return {
    getHourlyAggregation(
      exchange: string,
      symbol: string,
      windowStart: Date,
      windowEnd: Date,
    ): ResultAsync<HourlyAggregation, MetricsRepositoryError> {
      return ResultAsync.fromPromise(
        (async () => {
          // Count fills
          const fillsResult = await db
            .select({ count: count() })
            .from(fillsEnriched)
            .where(
              and(
                eq(fillsEnriched.exchange, exchange),
                eq(fillsEnriched.symbol, symbol),
                gte(fillsEnriched.ts, windowStart),
                lte(fillsEnriched.ts, windowEnd),
              ),
            );
          const fillsCount = fillsResult[0]?.count ?? 0;

          // Count cancels
          const cancelResult = await db
            .select({ count: count() })
            .from(exOrderEvent)
            .where(
              and(
                eq(exOrderEvent.exchange, exchange),
                eq(exOrderEvent.symbol, symbol),
                eq(exOrderEvent.eventType, "cancel"),
                gte(exOrderEvent.ts, windowStart),
                lte(exOrderEvent.ts, windowEnd),
              ),
            );
          const cancelCount = cancelResult[0]?.count ?? 0;

          // Count PAUSEs
          const pauseResult = await db
            .select({ count: count() })
            .from(strategyState)
            .where(
              and(
                eq(strategyState.exchange, exchange),
                eq(strategyState.symbol, symbol),
                eq(strategyState.mode, "PAUSE"),
                gte(strategyState.ts, windowStart),
                lte(strategyState.ts, windowEnd),
              ),
            );
          const pauseCount = pauseResult[0]?.count ?? 0;

          // Get markout percentiles
          const percentilesResult = await db.execute<{
            p10: string | null;
            p50: string | null;
            p90: string | null;
          }>(sql`
            SELECT
              PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY CAST(markout_10s_bps AS FLOAT)) as p10,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CAST(markout_10s_bps AS FLOAT)) as p50,
              PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY CAST(markout_10s_bps AS FLOAT)) as p90
            FROM fills_enriched
            WHERE exchange = ${exchange}
              AND symbol = ${symbol}
              AND ts >= ${windowStart}
              AND ts <= ${windowEnd}
              AND markout_10s_bps IS NOT NULL
          `);

          const percentiles = percentilesResult.rows[0];
          const markout10sP10 = percentiles.p10 !== null ? Number.parseFloat(percentiles.p10) : null;
          const markout10sP50 = percentiles.p50 !== null ? Number.parseFloat(percentiles.p50) : null;
          const markout10sP90 = percentiles.p90 !== null ? Number.parseFloat(percentiles.p90) : null;

          // Get worst fills
          const worstFillsResult = await db
            .select({
              id: fillsEnriched.id,
              ts: fillsEnriched.ts,
              side: fillsEnriched.side,
              fillPx: fillsEnriched.fillPx,
              fillSz: fillsEnriched.fillSz,
              markout10sBps: fillsEnriched.markout10sBps,
            })
            .from(fillsEnriched)
            .where(
              and(
                eq(fillsEnriched.exchange, exchange),
                eq(fillsEnriched.symbol, symbol),
                gte(fillsEnriched.ts, windowStart),
                lte(fillsEnriched.ts, windowEnd),
              ),
            )
            .orderBy(asc(fillsEnriched.markout10sBps))
            .limit(5);

          const worstFills: WorstFillSummary[] = worstFillsResult.map(row => ({
            fillId: row.id,
            ts: row.ts,
            side: row.side,
            fillPx: row.fillPx,
            fillSz: row.fillSz,
            markout10sBps: row.markout10sBps !== null ? Number.parseFloat(row.markout10sBps) : null,
          }));

          return {
            windowStart,
            windowEnd,
            fillsCount,
            cancelCount,
            pauseCount,
            markout10sP10,
            markout10sP50,
            markout10sP90,
            worstFills,
          };
        })(),
        e => ({
          type: "DB_ERROR" as const,
          message: e instanceof Error ? e.message : "Unknown error",
        }),
      );
    },

    getCurrentParams(exchange: string, symbol: string): ResultAsync<CurrentParamsSummary, MetricsRepositoryError> {
      return ResultAsync.fromPromise(
        db
          .select()
          .from(strategyParams)
          .where(
            and(
              eq(strategyParams.exchange, exchange),
              eq(strategyParams.symbol, symbol),
              eq(strategyParams.isCurrent, true),
            ),
          )
          .limit(1),
        e => ({
          type: "DB_ERROR" as const,
          message: e instanceof Error ? e.message : "Unknown error",
        }),
      ).andThen(rows => {
        // Requirement: Work with empty DB (no current params yet).
        // Keep reflector workflow running by returning safe defaults.
        if (rows.length === 0) {
          logger.debug(`No current params found for ${exchange}:${symbol}, using defaults`);
          return ResultAsync.fromSafePromise(
            Promise.resolve({
              paramsSetId: "00000000-0000-0000-0000-000000000000",
              baseHalfSpreadBps: "10",
              volSpreadGain: "1",
              toxSpreadGain: "1",
              quoteSizeUsd: "10",
              refreshIntervalMs: 1000,
              staleCancelMs: 5000,
              maxInventory: "1",
              inventorySkewGain: "5",
              pauseMarkIndexBps: "50",
              pauseLiqCount10s: 3,
            }),
          );
        }

        const row = rows[0];
        return ResultAsync.fromSafePromise(
          Promise.resolve({
            paramsSetId: row.id,
            baseHalfSpreadBps: row.baseHalfSpreadBps,
            volSpreadGain: row.volSpreadGain,
            toxSpreadGain: row.toxSpreadGain,
            quoteSizeUsd: row.quoteSizeUsd,
            refreshIntervalMs: row.refreshIntervalMs,
            staleCancelMs: row.staleCancelMs,
            maxInventory: row.maxInventory,
            inventorySkewGain: row.inventorySkewGain,
            pauseMarkIndexBps: row.pauseMarkIndexBps,
            pauseLiqCount10s: row.pauseLiqCount10s,
          }),
        );
      });
    },

    getWorstFills(
      exchange: string,
      symbol: string,
      windowStart: Date,
      windowEnd: Date,
      limit: number,
    ): ResultAsync<WorstFillSummary[], MetricsRepositoryError> {
      return ResultAsync.fromPromise(
        db
          .select({
            id: fillsEnriched.id,
            ts: fillsEnriched.ts,
            side: fillsEnriched.side,
            fillPx: fillsEnriched.fillPx,
            fillSz: fillsEnriched.fillSz,
            markout10sBps: fillsEnriched.markout10sBps,
          })
          .from(fillsEnriched)
          .where(
            and(
              eq(fillsEnriched.exchange, exchange),
              eq(fillsEnriched.symbol, symbol),
              gte(fillsEnriched.ts, windowStart),
              lte(fillsEnriched.ts, windowEnd),
            ),
          )
          .orderBy(asc(fillsEnriched.markout10sBps))
          .limit(limit),
        e => ({
          type: "DB_ERROR" as const,
          message: e instanceof Error ? e.message : "Unknown error",
        }),
      ).map(rows =>
        rows.map(row => ({
          fillId: row.id,
          ts: row.ts,
          side: row.side,
          fillPx: row.fillPx,
          fillSz: row.fillSz,
          markout10sBps: row.markout10sBps !== null ? Number.parseFloat(row.markout10sBps) : null,
        })),
      );
    },
  };
}
