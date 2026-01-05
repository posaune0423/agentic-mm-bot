/**
 * Proposal Repository Interface for Executor
 *
 * Requirements: 10.4, 10.5, 10.6
 */

import type { ResultAsync } from "neverthrow";

import type { LlmProposal, NewParamRollout, StrategyParams, NewStrategyParams } from "@agentic-mm-bot/db";

export type ProposalRepositoryError = { type: "DB_ERROR"; message: string } | { type: "NOT_FOUND"; message: string };

export interface ExecutorProposalRepository {
  /**
   * Get pending proposals for a symbol
   */
  getPendingProposals(exchange: string, symbol: string): ResultAsync<LlmProposal[], ProposalRepositoryError>;

  /**
   * Update proposal status (applied/rejected)
   */
  updateProposalStatus(
    proposalId: string,
    status: "applied" | "rejected",
    decidedBy: string,
    rejectReason?: string,
  ): ResultAsync<void, ProposalRepositoryError>;

  /**
   * Save param rollout audit record
   */
  saveParamRollout(rollout: NewParamRollout): ResultAsync<void, ProposalRepositoryError>;

  /**
   * Create new strategy params
   */
  createStrategyParams(params: NewStrategyParams): ResultAsync<StrategyParams, ProposalRepositoryError>;

  /**
   * Set current strategy params (unset old, set new)
   */
  setCurrentParams(exchange: string, symbol: string, newParamsId: string): ResultAsync<void, ProposalRepositoryError>;

  /**
   * Get current strategy params
   */
  getCurrentParams(exchange: string, symbol: string): ResultAsync<StrategyParams, ProposalRepositoryError>;
}
