/**
 * Postgres Proposal Repository
 *
 * Requirements: 10.1, 10.4, 10.5, 10.6
 * - Unified implementation for LLM proposal management
 * - Used by both llm-reflector and executor
 */

import { eq, and } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import {
  llmProposal,
  paramRollout,
  strategyParams,
  type Db,
  type LlmProposal,
  type NewLlmProposal,
  type NewParamRollout,
  type StrategyParams,
  type NewStrategyParams,
} from "@agentic-mm-bot/db";
import { logger } from "@agentic-mm-bot/utils";

import type { ProposalRepository, ProposalRepositoryError } from "../interfaces/proposal-repository";

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default strategy parameters used when DB is empty.
 *
 * Note:
 * - Keep these values consistent with executor/backtest defaults unless intentionally diverging.
 * - Stored as strings to match the DB layer numeric->string behavior in Drizzle.
 */
const DEFAULT_STRATEGY_PARAMS_VALUES = {
  baseHalfSpreadBps: "3",
  volSpreadGain: "1",
  toxSpreadGain: "1",
  quoteSizeUsd: "10",
  refreshIntervalMs: 1000,
  staleCancelMs: 5000,
  maxInventory: "1",
  inventorySkewGain: "5",
  pauseMarkIndexBps: "50",
  pauseLiqCount10s: 3,
} as const;

function buildSeededCurrentParams(exchange: string, symbol: string): NewStrategyParams {
  return {
    exchange,
    symbol,
    isCurrent: true,
    createdBy: "system",
    comment: "Seeded default parameters (empty DB)",
    ...DEFAULT_STRATEGY_PARAMS_VALUES,
  };
}

/**
 * Create a unified Postgres proposal repository
 */
export function createPostgresProposalRepository(db: Db): ProposalRepository {
  return {
    // ─────────────────────────────────────────────────────────────────────────────
    // Common operations
    // ─────────────────────────────────────────────────────────────────────────────

    getPendingProposals(exchange: string, symbol: string): ResultAsync<LlmProposal[], ProposalRepositoryError> {
      return ResultAsync.fromPromise(
        db
          .select()
          .from(llmProposal)
          .where(
            and(eq(llmProposal.exchange, exchange), eq(llmProposal.symbol, symbol), eq(llmProposal.status, "pending")),
          ),
        e => ({
          type: "DB_ERROR" as const,
          message: e instanceof Error ? e.message : "Unknown error",
        }),
      );
    },

    updateProposalStatus(
      proposalId: string,
      status: "applied" | "rejected",
      decidedBy: string,
      rejectReason?: string,
    ): ResultAsync<void, ProposalRepositoryError> {
      return ResultAsync.fromPromise(
        db
          .update(llmProposal)
          .set({
            status,
            decidedAt: new Date(),
            decidedBy,
            rejectReason,
          })
          .where(eq(llmProposal.id, proposalId)),
        e => ({
          type: "DB_ERROR" as const,
          message: e instanceof Error ? e.message : "Unknown error",
        }),
      ).map(() => undefined);
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // LLM Reflector operations
    // ─────────────────────────────────────────────────────────────────────────────

    saveProposal(proposal: NewLlmProposal): ResultAsync<LlmProposal, ProposalRepositoryError> {
      return ResultAsync.fromPromise(
        db
          .insert(llmProposal)
          .values(proposal)
          .returning()
          .then(rows => rows[0]),
        e => ({
          type: "DB_ERROR" as const,
          message: e instanceof Error ? e.message : "Unknown error",
        }),
      );
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // Executor operations
    // ─────────────────────────────────────────────────────────────────────────────

    saveParamRollout(rollout: NewParamRollout): ResultAsync<void, ProposalRepositoryError> {
      return ResultAsync.fromPromise(db.insert(paramRollout).values(rollout), e => ({
        type: "DB_ERROR" as const,
        message: e instanceof Error ? e.message : "Unknown error",
      })).map(() => undefined);
    },

    createStrategyParams(params: NewStrategyParams): ResultAsync<StrategyParams, ProposalRepositoryError> {
      return ResultAsync.fromPromise(
        db
          .insert(strategyParams)
          .values(params)
          .returning()
          .then(rows => rows[0]),
        e => ({
          type: "DB_ERROR" as const,
          message: e instanceof Error ? e.message : "Unknown error",
        }),
      );
    },

    setCurrentParams(
      exchange: string,
      symbol: string,
      newParamsId: string,
    ): ResultAsync<void, ProposalRepositoryError> {
      return ResultAsync.fromPromise(
        (async () => {
          // Unset all current params for this symbol
          await db
            .update(strategyParams)
            .set({ isCurrent: false })
            .where(
              and(
                eq(strategyParams.exchange, exchange),
                eq(strategyParams.symbol, symbol),
                eq(strategyParams.isCurrent, true),
              ),
            );

          // Set new params as current
          await db.update(strategyParams).set({ isCurrent: true }).where(eq(strategyParams.id, newParamsId));
        })(),
        e => ({
          type: "DB_ERROR" as const,
          message: e instanceof Error ? e.message : "Unknown error",
        }),
      );
    },

    getCurrentParams(exchange: string, symbol: string): ResultAsync<StrategyParams, ProposalRepositoryError> {
      const dbError = (e: unknown) => ({
        type: "DB_ERROR" as const,
        message: e instanceof Error ? e.message : "Unknown error",
      });

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
        dbError,
      ).andThen(rows => {
        if (rows.length > 0) {
          return ResultAsync.fromSafePromise(Promise.resolve(rows[0]));
        }

        /**
         * Requirement: Work with empty DB.
         *
         * Previously we returned in-memory defaults without persisting. That leaves
         * `strategy_params` empty forever, which makes it look like "params are not updating".
         *
         * Instead, seed a default params row in DB and mark it current.
         */
        logger.debug(`No current params found for ${exchange}:${symbol}; seeding defaults into DB`);

        return ResultAsync.fromPromise(
          (async () => {
            // Best-effort: ensure there's at most one current row for this key.
            await db
              .update(strategyParams)
              .set({ isCurrent: false })
              .where(
                and(
                  eq(strategyParams.exchange, exchange),
                  eq(strategyParams.symbol, symbol),
                  eq(strategyParams.isCurrent, true),
                ),
              );

            const seeded = await db
              .insert(strategyParams)
              .values(buildSeededCurrentParams(exchange, symbol))
              .returning()
              .then(r => r[0]);

            return seeded;
          })(),
          dbError,
        );
      });
    },
  };
}
