/**
 * Extended Exchange Adapter
 *
 * Requirements: 2.3
 * - Venue-specific implementation of MarketDataPort and ExecutionPort
 *
 * SDK: https://github.com/Bvvvp009/Extended-TS-SDK
 */

export { initWasm } from "extended-typescript-sdk";
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
export {
  WsConnection,
  createPublicStreamConnection,
  createPrivateStreamConnection,
  ExtendedStreamPaths,
  defaultConnectionFactory,
  type IWsConnection,
  type WsConnectionOptions,
  type ExtendedStreamConfig,
  type WsConnectionFactory,
} from "./ws-connection";
