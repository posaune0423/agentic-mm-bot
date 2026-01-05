/**
 * Summarizer Services
 *
 * Export all services for use in usecases and main.
 */

// BBO/Price lookup
export {
  findClosestBbo,
  findClosestPrice,
  BBO_TOLERANCE,
  type BboRef,
  type PriceRef,
} from "./bbo-lookup";

// Markout calculation
export {
  calculateMarkoutBps,
  calculateAllMarkouts,
  type MarkoutResult,
} from "./markout-calculator";

// Feature calculation
export {
  calculateTradeImbalance1s,
  calculateLiqCount10s,
  calculateMarkIndexDivBps,
  calculateRealizedVol10s,
  calculateAllFeatures,
  type FeatureResult,
} from "./feature-calculator";

// Aggregation
export {
  getWorstFills,
  getAggregation,
  generate1MinAggregation,
  generate1HourAggregation,
  type AggregationResult,
  type WorstFill,
} from "./aggregation";
