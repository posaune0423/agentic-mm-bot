/**
 * Proposal Repository Interface
 *
 * Requirements: 10.1, 10.6
 */

import type { ResultAsync } from "neverthrow";

import type { LlmProposal, NewLlmProposal } from "@agentic-mm-bot/db";

export type ProposalRepositoryError = { type: "DB_ERROR"; message: string } | { type: "NOT_FOUND"; message: string };

export interface ProposalRepository {
  /**
   * Save a new proposal
   */
  saveProposal(proposal: NewLlmProposal): ResultAsync<LlmProposal, ProposalRepositoryError>;

  /**
   * Get pending proposals for a symbol
   */
  getPendingProposals(exchange: string, symbol: string): ResultAsync<LlmProposal[], ProposalRepositoryError>;

  /**
   * Update proposal status (apply/reject)
   */
  updateProposalStatus(
    proposalId: string,
    status: "applied" | "rejected",
    decidedBy: string,
    rejectReason?: string,
  ): ResultAsync<void, ProposalRepositoryError>;
}
