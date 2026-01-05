/**
 * Proposal Repository Interface
 *
 * Requirements: 10.1, 10.4, 10.5, 10.6
 * - Unified interface for LLM proposal management
 * - Used by both llm-reflector (create proposals) and executor (apply proposals)
 */

import type { ResultAsync } from "neverthrow";

import type {
  LlmProposal,
  NewLlmProposal,
  NewParamRollout,
  StrategyParams,
  NewStrategyParams,
} from "@agentic-mm-bot/db";

export type ProposalRepositoryError = { type: "DB_ERROR"; message: string } | { type: "NOT_FOUND"; message: string };

/**
 * Unified Proposal Repository Interface
 *
 * Combines methods from llm-reflector (save) and executor (apply/rollout/params management)
 */
export interface ProposalRepository {
  // ─────────────────────────────────────────────────────────────────────────────
  // Common operations (used by both apps)
  // ─────────────────────────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────────────────────────
  // LLM Reflector operations (proposal generation)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Save a new proposal
   */
  saveProposal(proposal: NewLlmProposal): ResultAsync<LlmProposal, ProposalRepositoryError>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Executor operations (proposal application & params management)
  // ─────────────────────────────────────────────────────────────────────────────

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
