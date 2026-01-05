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

import type { ProposalRepository, ProposalRepositoryError } from "../interfaces/proposal-repository";

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
          // Fallback to default params if not found (Requirement: Work with empty DB)
          return ResultAsync.fromSafePromise(
            Promise.resolve({
              id: "00000000-0000-0000-0000-000000000000",
              exchange,
              symbol,
              baseHalfSpreadBps: "10",
              volSpreadGain: "1",
              toxSpreadGain: "1",
              quoteSizeUsd: "100",
              refreshIntervalMs: 1000,
              staleCancelMs: 5000,
              maxInventory: "1",
              inventorySkewGain: "5",
              pauseMarkIndexBps: "50",
              pauseLiqCount10s: 3,
              isCurrent: true,
              createdAt: new Date(),
              createdBy: "system",
              comment: "Default parameters",
            }),
          );
        }
        return ResultAsync.fromSafePromise(Promise.resolve(rows[0]));
      });
    },
  };
}
