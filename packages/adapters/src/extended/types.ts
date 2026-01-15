/**
 * Extended Exchange Types
 *
 * SDK: https://github.com/Bvvvp009/Extended-TS-SDK
 * Documentation: https://api.docs.extended.exchange/
 */

import { z } from "zod";

/**
 * Extended exchange configuration schema
 *
 * Uses Extended SDK's EndpointConfig internally, but this schema
 * represents the user-provided configuration needed to initialize the adapters.
 */
export const ExtendedConfigSchema = z.object({
  /**
   * Use testnet or mainnet
   */
  network: z.enum(["testnet", "mainnet"]).default("testnet"),

  /**
   * Vault ID from Extended Exchange
   */
  vaultId: z.coerce.number(),

  /**
   * Stark private key (hex string)
   */
  starkPrivateKey: z.string().regex(/^0x[a-fA-F0-9]+$/, "Must be a hex string starting with 0x"),

  /**
   * Stark public key (hex string)
   */
  starkPublicKey: z.string().regex(/^0x[a-fA-F0-9]+$/, "Must be a hex string starting with 0x"),

  /**
   * API key from Extended Exchange
   */
  apiKey: z.string().min(1),
});

export type ExtendedConfig = z.infer<typeof ExtendedConfigSchema>;

/**
 * WebSocket message types from Extended
 * These are normalized from the SDK's stream responses
 */
export interface ExtendedWsBboMessage {
  type: "bbo";
  data: {
    symbol: string;
    bid_price: string;
    bid_size: string;
    ask_price: string;
    ask_size: string;
    timestamp: number;
    sequence?: number;
  };
}

export interface ExtendedWsTradeMessage {
  type: "trade";
  data: {
    symbol: string;
    trade_id: string;
    price: string;
    size: string;
    side?: "buy" | "sell";
    trade_type?: "normal" | "liquidation" | "deleverage";
    timestamp: number;
    sequence?: number;
  };
}

export interface ExtendedWsPriceMessage {
  type: "price";
  data: {
    symbol: string;
    mark_price?: string;
    index_price?: string;
    timestamp: number;
  };
}

export type ExtendedWsMessage = ExtendedWsBboMessage | ExtendedWsTradeMessage | ExtendedWsPriceMessage;

/**
 * Account stream data for private WebSocket
 */
export interface ExtendedAccountStreamData {
  orders?: ExtendedOrderUpdate[];
  positions?: ExtendedPositionUpdate[];
  trades?: ExtendedTradeUpdate[];
  balance?: ExtendedBalanceUpdate;
}

export interface ExtendedOrderUpdate {
  id: number;
  externalId: string;
  market: string;
  type: string;
  side: string;
  status: string;
  statusReason?: string;
  price: string;
  averagePrice?: string;
  qty: string;
  filledQty?: string;
  reduceOnly: boolean;
  postOnly: boolean;
  createdTime: number;
  updatedTime: number;
}

export interface ExtendedPositionUpdate {
  id: number;
  market: string;
  side: string;
  size: string;
  value: string;
  openPrice: string;
  markPrice: string;
  liquidationPrice?: string;
  unrealisedPnl: string;
  realisedPnl: string;
}

export interface ExtendedTradeUpdate {
  id: number;
  orderId: number;
  /**
   * Some payloads include the client-provided external order id (our clientOrderId).
   * Naming varies across API/SDK versions.
   */
  externalOrderId?: string;
  externalId?: string;
  market: string;
  side: string;
  price: string;
  qty: string;
  fee: string;
  /**
   * Trade classification / maker-taker hints (naming varies).
   * Examples seen in the wild: tradeType, type, isTaker.
   */
  tradeType?: string;
  type: string;
  isTaker?: boolean;
  createdTime: number;
}

export interface ExtendedBalanceUpdate {
  collateralName: string;
  balance: string;
  equity: string;
  availableForTrade: string;
  availableForWithdrawal: string;
  unrealisedPnl: string;
  initialMargin: string;
  marginRatio: string;
  updatedTime: number;
}
