/**
 * Metrics Repository Interface
 *
 * Requirements: 10.1, 9.6
 */

import type { ResultAsync } from "neverthrow";

import type { HourlyAggregation, CurrentParamsSummary, WorstFillSummary } from "../../types";

export type MetricsRepositoryError = { type: "DB_ERROR"; message: string } | { type: "NOT_FOUND"; message: string };

export interface MetricsRepository {
  /**
   * Get hourly aggregation for LLM input
   */
  getHourlyAggregation(
    exchange: string,
    symbol: string,
    windowStart: Date,
    windowEnd: Date,
  ): ResultAsync<HourlyAggregation, MetricsRepositoryError>;

  /**
   * Get current strategy params
   */
  getCurrentParams(exchange: string, symbol: string): ResultAsync<CurrentParamsSummary, MetricsRepositoryError>;

  /**
   * Get worst fills for a time window
   */
  getWorstFills(
    exchange: string,
    symbol: string,
    windowStart: Date,
    windowEnd: Date,
    limit: number,
  ): ResultAsync<WorstFillSummary[], MetricsRepositoryError>;
}
