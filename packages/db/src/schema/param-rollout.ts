/**
 * param_rollout - Parameter Rollout Audit (適用監査)
 *
 * Requirements: 10.6, 12.4
 * - Future Extension: Audit trail for param changes
 * - Tracks apply/reject/rollback actions
 */

import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const paramRollout = pgTable("param_rollout", {
  id: uuid("id").primaryKey().defaultRandom(), // rollout_id
  ts: timestamp("ts", { withTimezone: true, mode: "date" }).notNull(),
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  proposalId: uuid("proposal_id"), // null if manual
  fromParamsSetId: uuid("from_params_set_id").notNull(),
  toParamsSetId: uuid("to_params_set_id"), // null if rejected
  action: text("action").notNull(), // apply/reject/rollback
  reason: text("reason"),
  metricsSnapshotJson: jsonb("metrics_snapshot_json"),
});

export type ParamRollout = typeof paramRollout.$inferSelect;
export type NewParamRollout = typeof paramRollout.$inferInsert;
