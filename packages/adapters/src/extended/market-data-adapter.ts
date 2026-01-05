/**
 * Extended Market Data Adapter
 *
 * Requirements: 3.1, 3.4, 3.5
 * - WS subscription for BBO/Trades/Mark/Index via Extended SDK
 * - Exponential backoff reconnection
 * - Sequence break detection and recovery
 *
 * SDK: https://github.com/Bvvvp009/Extended-TS-SDK
 */

import {
  TESTNET_CONFIG,
  MAINNET_CONFIG,
  PerpetualStreamClient,
  type EndpointConfig,
  type PerpetualStreamConnection,
} from "extended-typescript-sdk";
import { err, ok, type Result } from "neverthrow";

import type {
  BboEvent,
  ConnectionEvent,
  MarketDataError,
  MarketDataEvent,
  MarketDataPort,
  MarketDataSubscription,
  PriceEvent,
  TradeEvent,
} from "../ports";
import type { ExtendedConfig } from "./types";

const EXCHANGE_NAME = "extended";

/**
 * Reconnection configuration
 */
interface ReconnectConfig {
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
}

const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  multiplier: 2,
};

/**
 * Stream subscription state
 */
interface StreamState {
  connection: PerpetualStreamConnection<unknown>;
  subscription: MarketDataSubscription;
  isRunning: boolean;
}

/**
 * Extended Market Data Adapter
 *
 * Implements MarketDataPort for Extended exchange using extended-typescript-sdk
 */
export class ExtendedMarketDataAdapter implements MarketDataPort {
  private config: ExtendedConfig;
  private endpointConfig: EndpointConfig;
  private streamClient: PerpetualStreamClient;

  private eventHandlers: ((event: MarketDataEvent) => void)[] = [];
  private subscriptions: MarketDataSubscription[] = [];
  private activeStreams: Map<string, StreamState> = new Map();
  private reconnectConfig: ReconnectConfig;
  private reconnectAttempt = 0;
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastSeq: Map<string, number> = new Map();
  private isConnected_ = false;

  constructor(config: ExtendedConfig, reconnectConfig: ReconnectConfig = DEFAULT_RECONNECT_CONFIG) {
    this.config = config;
    this.endpointConfig = config.network === "mainnet" ? MAINNET_CONFIG : TESTNET_CONFIG;
    this.streamClient = new PerpetualStreamClient({ apiUrl: this.endpointConfig.streamUrl });
    this.reconnectConfig = reconnectConfig;
  }

  subscribe(subscription: MarketDataSubscription): Result<void, MarketDataError> {
    this.subscriptions.push(subscription);

    if (this.isConnected_) {
      void this.startSubscription(subscription);
    }

    return ok(undefined);
  }

  unsubscribe(subscription: MarketDataSubscription): Result<void, MarketDataError> {
    this.subscriptions = this.subscriptions.filter(
      s => !(s.exchange === subscription.exchange && s.symbol === subscription.symbol),
    );

    // Close active streams for this subscription
    for (const channel of subscription.channels) {
      const key = `${subscription.symbol}:${channel}`;
      const state = this.activeStreams.get(key);

      if (state) {
        state.isRunning = false;
        void state.connection.close();
        this.activeStreams.delete(key);
      }
    }

    return ok(undefined);
  }

  async connect(): Promise<Result<void, MarketDataError>> {
    try {
      this.isConnected_ = true;
      this.reconnectAttempt = 0;

      this.emitEvent({
        type: "connected",
        ts: new Date(),
        exchange: EXCHANGE_NAME,
      });

      // Start all pending subscriptions
      for (const sub of this.subscriptions) {
        await this.startSubscription(sub);
      }

      return ok(undefined);
    } catch (error) {
      return err({
        type: "connection_failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  async disconnect(): Promise<Result<void, MarketDataError>> {
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    // Close all active streams
    for (const [, state] of this.activeStreams) {
      state.isRunning = false;
      await state.connection.close();
    }
    this.activeStreams.clear();

    this.isConnected_ = false;

    return ok(undefined);
  }

  onEvent(handler: (event: MarketDataEvent) => void): void {
    this.eventHandlers.push(handler);
  }

  isConnected(): boolean {
    return this.isConnected_;
  }

  private async startSubscription(subscription: MarketDataSubscription): Promise<void> {
    for (const channel of subscription.channels) {
      const key = `${subscription.symbol}:${channel}`;

      if (this.activeStreams.has(key)) continue;

      try {
        const connection = this.createStreamConnection(subscription.symbol, channel);
        if (!connection) continue;

        const connectedStream = await connection.connect();

        const state: StreamState = {
          connection: connectedStream,
          subscription,
          isRunning: true,
        };

        this.activeStreams.set(key, state);

        // Start listening in background
        void this.listenStream(state, channel, subscription.symbol);
      } catch {
        // Connection failed, schedule reconnect
        this.scheduleReconnect();
      }
    }
  }

  private createStreamConnection(
    symbol: string,
    channel: "bbo" | "trades" | "prices",
  ): PerpetualStreamConnection<unknown> | null {
    switch (channel) {
      case "bbo":
        return this.streamClient.subscribeToOrderbooks({ marketName: symbol, depth: 1 });
      case "trades":
        return this.streamClient.subscribeToPublicTrades(symbol);
      case "prices":
        // Use funding rates stream as price source (available in current SDK version)
        // Mark/Index price streams are available in newer SDK versions
        return this.streamClient.subscribeToFundingRates(symbol);
      default:
        return null;
    }
  }

  private async listenStream(state: StreamState, channel: string, symbol: string): Promise<void> {
    try {
      for await (const message of state.connection) {
        if (!state.isRunning) break;

        const event = this.normalizeMessage(message.data, channel, symbol);
        if (event) {
          this.checkSequence(event);
          this.emitEvent(event);
        }
      }
    } catch {
      // Stream disconnected
      if (state.isRunning) {
        this.handleDisconnect();
      }
    }
  }

  private emitEvent(event: MarketDataEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }

  private handleDisconnect(): void {
    this.emitEvent({
      type: "disconnected",
      ts: new Date(),
      exchange: EXCHANGE_NAME,
    });

    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeoutId) return;

    const delay = Math.min(
      this.reconnectConfig.initialDelayMs * Math.pow(this.reconnectConfig.multiplier, this.reconnectAttempt),
      this.reconnectConfig.maxDelayMs,
    );

    this.reconnectAttempt++;

    this.emitEvent({
      type: "reconnecting",
      ts: new Date(),
      exchange: EXCHANGE_NAME,
      reason: `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`,
    });

    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectTimeoutId = null;

      // Close all existing streams
      void (async () => {
        for (const [, state] of this.activeStreams) {
          state.isRunning = false;
          await state.connection.close();
        }
        this.activeStreams.clear();

        // Reconnect
        void this.connect();
      })();
    }, delay);
  }

  private normalizeMessage(data: unknown, channel: string, symbol: string): MarketDataEvent | null {
    if (!data || typeof data !== "object") return null;

    const message = data as Record<string, unknown>;

    switch (channel) {
      case "bbo":
        return this.normalizeBbo(message, symbol);
      case "trades":
        return this.normalizeTrade(message, symbol);
      case "prices":
        return this.normalizePrice(message, symbol);
      default:
        return null;
    }
  }

  private normalizeBbo(message: Record<string, unknown>, symbol: string): BboEvent | null {
    // Extended orderbook format: { bids: [[price, size], ...], asks: [[price, size], ...] }
    const bids = message.bids as [string, string][] | undefined;
    const asks = message.asks as [string, string][] | undefined;

    if (!bids?.length || !asks?.length) return null;

    const [bestBidPx, bestBidSz] = bids[0];
    const [bestAskPx, bestAskSz] = asks[0];

    return {
      type: "bbo",
      ts: new Date((message.timestamp as number | undefined) ?? Date.now()),
      exchange: EXCHANGE_NAME,
      symbol,
      bestBidPx,
      bestBidSz,
      bestAskPx,
      bestAskSz,
      seq: message.sequence as number | undefined,
      raw: message,
    };
  }

  private normalizeTrade(message: Record<string, unknown>, symbol: string): TradeEvent | null {
    // Extended trade format
    const price = message.price as string | undefined;
    const size = (message.qty ?? message.size) as string | undefined;

    if (!price || !size) return null;

    const sideRaw = message.side as string | undefined;
    const side =
      sideRaw?.toUpperCase() === "BUY" ? "buy"
      : sideRaw?.toUpperCase() === "SELL" ? "sell"
      : undefined;

    const tradeTypeRaw = message.type as string | undefined;
    let tradeType: "normal" | "liq" | "delev" | undefined;
    if (tradeTypeRaw === "LIQUIDATION") {
      tradeType = "liq";
    } else if (tradeTypeRaw === "ADL") {
      tradeType = "delev";
    } else {
      tradeType = "normal";
    }

    const timestamp =
      (message.createdTime as number | undefined) ?? (message.timestamp as number | undefined) ?? Date.now();
    const tradeId =
      (
        message.id !== undefined &&
        message.id !== null &&
        (typeof message.id === "string" || typeof message.id === "number")
      ) ?
        String(message.id)
      : (message.tradeId as string | undefined);

    return {
      type: "trade",
      ts: new Date(timestamp),
      exchange: EXCHANGE_NAME,
      symbol,
      tradeId: tradeId ?? "",
      side,
      px: price,
      sz: size,
      tradeType,
      seq: message.sequence as number | undefined,
      raw: message,
    };
  }

  private normalizePrice(message: Record<string, unknown>, symbol: string): PriceEvent | null {
    const markPx = (message.markPrice ?? message.mark_price) as string | undefined;
    const indexPx = (message.indexPrice ?? message.index_price) as string | undefined;

    if (!markPx && !indexPx) return null;

    const priceTimestamp =
      (message.timestamp as number | undefined) ?? (message.updatedTime as number | undefined) ?? Date.now();

    return {
      type: "price",
      ts: new Date(priceTimestamp),
      exchange: EXCHANGE_NAME,
      symbol,
      markPx,
      indexPx,
      raw: message,
    };
  }

  private checkSequence(event: BboEvent | TradeEvent | PriceEvent | ConnectionEvent): void {
    if (event.type === "connected" || event.type === "disconnected" || event.type === "reconnecting") return;
    if (!("seq" in event) || event.seq === undefined) return;

    const key = `${event.exchange}:${event.symbol}:${event.type}`;
    const lastSeq = this.lastSeq.get(key);

    if (lastSeq !== undefined && event.seq !== lastSeq + 1) {
      // Sequence break detected - reconnect to recover
      void this.disconnect().then(() => {
        void this.connect();
      });
    }

    this.lastSeq.set(key, event.seq);
  }
}
