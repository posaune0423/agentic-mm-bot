/**
 * Postgres Proposal Repository for Executor
 *
 * Requirements: 10.4, 10.5, 10.6
 */

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, and } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import {
  llmProposal,
  paramRollout,
  strategyParams,
  type LlmProposal,
  type NewParamRollout,
  type StrategyParams,
  type NewStrategyParams,
} from "@agentic-mm-bot/db";

import type { ExecutorProposalRepository, ProposalRepositoryError } from "../interfaces/proposal-repository";

export function createPostgresProposalRepository(db: NodePgDatabase): ExecutorProposalRepository {
  return {
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
        if (rows.length === 0) {
          return ResultAsync.fromSafePromise(Promise.reject(new Error("Proposal not found")));
        }
        return ResultAsync.fromSafePromise(Promise.resolve(rows[0]));
      });
    },
  };
}
