/**
 * Extended Exchange Adapter
 *
 * Requirements: 2.3
 * - Venue-specific implementation of MarketDataPort and ExecutionPort
 *
 * SDK: https://github.com/Bvvvp009/Extended-TS-SDK
 */

export { ExtendedMarketDataAdapter } from "./market-data-adapter";
export { ExtendedExecutionAdapter } from "./execution-adapter";
export { ExtendedConfigSchema, type ExtendedConfig } from "./types";
export type {
  ExtendedWsMessage,
  ExtendedWsBboMessage,
  ExtendedWsTradeMessage,
  ExtendedWsPriceMessage,
  ExtendedAccountStreamData,
  ExtendedOrderUpdate,
  ExtendedPositionUpdate,
  ExtendedTradeUpdate,
  ExtendedBalanceUpdate,
} from "./types";
