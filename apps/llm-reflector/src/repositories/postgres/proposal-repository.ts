/**
 * Postgres Proposal Repository
 *
 * Requirements: 10.1, 10.6
 */

import { eq, and } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import { llmProposal, type Db, type LlmProposal, type NewLlmProposal } from "@agentic-mm-bot/db";

import type { ProposalRepository, ProposalRepositoryError } from "../interfaces/proposal-repository";

export function createPostgresProposalRepository(db: Db): ProposalRepository {
  return {
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
  };
}
