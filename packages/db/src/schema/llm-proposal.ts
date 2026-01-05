/**
 * llm_proposal - LLM Proposals (提案 + ログ参照)
 *
 * Requirements: 10.1, 10.2, 10.3, 12.4
 * - Future Extension: LLM improvement loop
 * - Contains proposal JSON and reasoning log reference
 */

import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const llmProposal = pgTable("llm_proposal", {
  id: uuid("id").primaryKey().defaultRandom(), // proposal_id
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  ts: timestamp("ts", { withTimezone: true, mode: "date" }).notNull(),
  inputWindowStart: timestamp("input_window_start", { withTimezone: true, mode: "date" }).notNull(),
  inputWindowEnd: timestamp("input_window_end", { withTimezone: true, mode: "date" }).notNull(),
  currentParamsSetId: uuid("current_params_set_id").notNull(),
  proposalJson: jsonb("proposal_json").notNull(), // max 2 changes
  rollbackJson: jsonb("rollback_json").notNull(), // conditions
  reasoningLogPath: text("reasoning_log_path").notNull(),
  reasoningLogSha256: text("reasoning_log_sha256").notNull(),
  status: text("status").notNull(), // pending/applied/rejected
  decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
  decidedBy: text("decided_by"),
  rejectReason: text("reject_reason"),
});

export type LlmProposal = typeof llmProposal.$inferSelect;
export type NewLlmProposal = typeof llmProposal.$inferInsert;
