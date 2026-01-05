/**
 * Extended Market Data Adapter
 *
 * Requirements: 3.1, 3.4, 3.5, 3.6
 * - WS subscription for BBO/Trades/Mark/Index/Funding via Extended SDK
 * - Exponential backoff reconnection
 * - Sequence break detection and recovery
 * - Normalization from Extended API doc types to domain events
 *
 * SDK: https://github.com/Bvvvp009/Extended-TS-SDK
 * API Docs: https://api.docs.extended.exchange/
 */

import {
  TESTNET_CONFIG,
  MAINNET_CONFIG,
  PerpetualStreamClient,
  type EndpointConfig,
  type PerpetualStreamConnection,
} from "extended-typescript-sdk";
import { err, ok, type Result } from "neverthrow";
import { logger } from "@agentic-mm-bot/utils";

import type {
  BboEvent,
  FundingRateEvent,
  MarketDataError,
  MarketDataEvent,
  MarketDataPort,
  MarketDataSubscription,
  PriceEvent,
  TradeEvent,
} from "../ports";
import type { ExtendedConfig } from "./types";

const EXCHANGE_NAME = "extended";
const log = logger;

// ============================================================================
// Extended WS Message Types (from API docs)
// ============================================================================

/**
 * Order book stream message
 * @see https://api.docs.extended.exchange/#order-book-stream
 */
interface OrderbookWsMessage {
  ts: number;
  type: "SNAPSHOT" | "DELTA";
  data: {
    m: string;
    b: Array<{ p: string; q: string }>;
    a: Array<{ p: string; q: string }>;
  };
  seq: number;
}

/**
 * Trades stream message
 * @see https://api.docs.extended.exchange/#trades-stream
 */
interface TradesWsMessage {
  ts: number;
  data: Array<{
    m: string;
    S: "BUY" | "SELL";
    tT: "TRADE" | "LIQUIDATION" | "DELEVERAGE";
    T: number;
    p: string;
    q: string;
    i: number;
  }>;
  seq: number;
}

/**
 * Funding rates stream message
 * @see https://api.docs.extended.exchange/#funding-rates-stream
 */
interface FundingRateWsMessage {
  ts: number;
  data: {
    m: string;
    T: number;
    f: string;
  };
  seq: number;
}

/**
 * Mark price stream message
 * @see https://api.docs.extended.exchange/#mark-price-stream
 */
interface MarkPriceWsMessage {
  type: "MP";
  data: {
    m: string;
    p: string;
    ts: number;
  };
  ts: number;
  seq: number;
  sourceEventId: number | null;
}

/**
 * Index price stream message
 * @see https://api.docs.extended.exchange/#index-price-stream
 */
interface IndexPriceWsMessage {
  type: "IP";
  data: {
    m: string;
    p: string;
    ts: number;
  };
  ts: number;
  seq: number;
  sourceEventId: number | null;
}

// ============================================================================
// Reconnection Configuration
// ============================================================================

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

// ============================================================================
// Stream Types
// ============================================================================

type StreamType = "orderbook" | "trades" | "markPrice" | "indexPrice" | "fundingRate";

type NormalizedMarketDataEvent = BboEvent | TradeEvent | PriceEvent | FundingRateEvent;

interface StreamState {
  connection: PerpetualStreamConnection<unknown>;
  streamType: StreamType;
  symbol: string;
  isRunning: boolean;
  abortController: AbortController;
}

// ============================================================================
// ExtendedMarketDataAdapter
// ============================================================================

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
  private isReconnecting_ = false;

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
    this.stopStreamsForSubscription(subscription);

    return ok(undefined);
  }

  async connect(): Promise<Result<void, MarketDataError>> {
    try {
      this.isConnected_ = true;
      this.reconnectAttempt = 0;
      this.isReconnecting_ = false;

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

    // Stop all active streams
    await this.stopAllStreams();

    this.isConnected_ = false;
    this.isReconnecting_ = false;

    this.emitEvent({
      type: "disconnected",
      ts: new Date(),
      exchange: EXCHANGE_NAME,
    });

    return ok(undefined);
  }

  onEvent(handler: (event: MarketDataEvent) => void): void {
    this.eventHandlers.push(handler);
  }

  isConnected(): boolean {
    return this.isConnected_;
  }

  // ============================================================================
  // Stream Management
  // ============================================================================

  private async startSubscription(subscription: MarketDataSubscription): Promise<void> {
    const symbol = subscription.symbol;

    for (const channel of subscription.channels) {
      const streamTypes = this.channelToStreamTypes(channel);

      for (const streamType of streamTypes) {
        const key = `${symbol}:${streamType}`;

        if (this.activeStreams.has(key)) continue;

        try {
          await this.startStream(symbol, streamType);
        } catch (error) {
          log.warn(`Failed to start ${streamType} stream for ${symbol}`, { error });
          this.scheduleReconnect();
        }
      }
    }
  }

  private channelToStreamTypes(channel: "bbo" | "trades" | "prices" | "funding"): StreamType[] {
    switch (channel) {
      case "bbo":
        return ["orderbook"];
      case "trades":
        return ["trades"];
      case "prices":
        // NOTE: Mark/Index price streams exist in the API docs, but the current SDK version
        // used here doesn't expose subscriptions for them. We keep the types/normalizers in
        // place for future support, but don't subscribe yet.
        return [];
      case "funding":
        return ["fundingRate"];
      default:
        return [];
    }
  }

  private async startStream(symbol: string, streamType: StreamType): Promise<void> {
    const key = `${symbol}:${streamType}`;
    const connection = this.createStreamConnection(symbol, streamType);

    if (!connection) {
      log.warn(`No stream connection available for ${streamType}`);
      return;
    }

    await connection.connect();

    const abortController = new AbortController();
    const state: StreamState = {
      connection,
      streamType,
      symbol,
      isRunning: true,
      abortController,
    };

    this.activeStreams.set(key, state);

    // Start listening in background
    void this.listenStream(state);
  }

  private createStreamConnection(symbol: string, streamType: StreamType): PerpetualStreamConnection<unknown> | null {
    switch (streamType) {
      case "orderbook":
        return this.streamClient.subscribeToOrderbooks({ marketName: symbol, depth: 1 });
      case "trades":
        return this.streamClient.subscribeToPublicTrades(symbol);
      case "fundingRate":
        return this.streamClient.subscribeToFundingRates(symbol);
      case "markPrice":
      case "indexPrice":
        return null;
      default:
        return null;
    }
  }

  private async listenStream(state: StreamState): Promise<void> {
    const { streamType, symbol } = state;

    try {
      for await (const message of state.connection) {
        if (!state.isRunning) break;

        const events = this.normalizeMessage(message, streamType, symbol);

        for (const event of events) {
          const seqBreak = this.checkSequence(event, streamType);

          if (seqBreak) {
            // For orderbook/mark/index, reconnect immediately
            // For trades/funding, just log (doc says skip is OK)
            if (streamType === "orderbook" || streamType === "markPrice" || streamType === "indexPrice") {
              log.warn(`Sequence break on ${streamType}, triggering reconnect`, {
                expected: seqBreak.expected,
                actual: seqBreak.actual,
              });
              this.scheduleReconnect();
              return;
            } else {
              log.warn(`Sequence gap on ${streamType} (non-critical)`, {
                expected: seqBreak.expected,
                actual: seqBreak.actual,
              });
            }
          }

          this.emitEvent(event);
        }
      }
    } catch (error) {
      if (state.isRunning) {
        log.warn(`Stream ${streamType} disconnected`, { error });
        this.handleDisconnect();
      }
    }
  }

  private stopStreamsForSubscription(subscription: MarketDataSubscription): void {
    for (const channel of subscription.channels) {
      const streamTypes = this.channelToStreamTypes(channel);

      for (const streamType of streamTypes) {
        const key = `${subscription.symbol}:${streamType}`;
        const state = this.activeStreams.get(key);

        if (state) {
          state.isRunning = false;
          state.abortController.abort();
          void state.connection.close();
          this.activeStreams.delete(key);
        }
      }
    }
  }

  private async stopAllStreams(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    for (const [key, state] of this.activeStreams) {
      state.isRunning = false;
      state.abortController.abort();
      closePromises.push(state.connection.close());
      this.activeStreams.delete(key);
    }

    await Promise.allSettled(closePromises);
  }

  // ============================================================================
  // Event Handling
  // ============================================================================

  private emitEvent(event: MarketDataEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        log.error("Event handler threw an error", { error });
      }
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
    if (this.reconnectTimeoutId || this.isReconnecting_) return;

    this.isReconnecting_ = true;

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

    log.info(`Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempt})`);

    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectTimeoutId = null;

      void (async () => {
        // Clear sequence tracking for fresh start
        this.lastSeq.clear();

        // Stop all existing streams
        await this.stopAllStreams();

        // Reconnect
        await this.connect();
      })();
    }, delay);
  }

  // ============================================================================
  // Sequence Checking
  // ============================================================================

  private checkSequence(
    event: BboEvent | TradeEvent | PriceEvent | FundingRateEvent,
    streamType: StreamType,
  ): { expected: number; actual: number } | null {
    if (!("seq" in event) || event.seq === undefined) return null;

    const key = `${event.exchange}:${event.symbol}:${streamType}`;
    const lastSeq = this.lastSeq.get(key);

    if (lastSeq !== undefined && event.seq !== lastSeq + 1) {
      const result = { expected: lastSeq + 1, actual: event.seq };
      this.lastSeq.set(key, event.seq);
      return result;
    }

    this.lastSeq.set(key, event.seq);
    return null;
  }

  // ============================================================================
  // Message Normalization (Extended API doc → Domain)
  // ============================================================================

  private normalizeMessage(data: unknown, streamType: StreamType, symbol: string): NormalizedMarketDataEvent[] {
    if (!data || typeof data !== "object") return [];

    switch (streamType) {
      case "orderbook":
        return this.normalizeOrderbook(data as OrderbookWsMessage, symbol);
      case "trades":
        return this.normalizeTrades(data as TradesWsMessage, symbol);
      case "markPrice":
        return this.normalizeMarkPrice(data as MarkPriceWsMessage, symbol);
      case "indexPrice":
        return this.normalizeIndexPrice(data as IndexPriceWsMessage, symbol);
      case "fundingRate":
        return this.normalizeFundingRate(data as FundingRateWsMessage, symbol);
      default:
        return [];
    }
  }

  /**
   * Normalize orderbook message to BboEvent
   *
   * Extended format:
   * { ts, type: "SNAPSHOT"|"DELTA", data: { m, b: [{p, q}], a: [{p, q}] }, seq }
   */
  private normalizeOrderbook(message: OrderbookWsMessage, symbol: string): BboEvent[] {
    // For depth=1, we always expect SNAPSHOT. DELTA is unexpected.
    if (message.type === "DELTA") {
      log.warn("Unexpected DELTA on depth=1 orderbook stream, triggering reconnect");
      this.scheduleReconnect();
      return [];
    }

    const bids = message.data.b;
    const asks = message.data.a;

    if (!bids.length || !asks.length) return [];

    const bestBid = bids[0];
    const bestAsk = asks[0];

    const event: BboEvent = {
      type: "bbo",
      exchange: EXCHANGE_NAME,
      symbol,
      ts: new Date(message.ts),
      bestBidPx: bestBid.p,
      bestBidSz: bestBid.q,
      bestAskPx: bestAsk.p,
      bestAskSz: bestAsk.q,
      seq: message.seq,
      raw: message,
    };

    return [event];
  }

  /**
   * Normalize trades message to TradeEvent[]
   *
   * Extended format:
   * { ts, data: [{ m, S, tT, T, p, q, i }], seq }
   */
  private normalizeTrades(message: TradesWsMessage, symbol: string): TradeEvent[] {
    const events: TradeEvent[] = [];

    if (!message.data.length) return events;

    for (const item of message.data) {
      const side: "buy" | "sell" = item.S === "BUY" ? "buy" : "sell";

      let tradeType: "normal" | "liq" | "delev";
      switch (item.tT) {
        case "LIQUIDATION":
          tradeType = "liq";
          break;
        case "DELEVERAGE":
          tradeType = "delev";
          break;
        default:
          tradeType = "normal";
      }

      const event: TradeEvent = {
        type: "trade",
        exchange: EXCHANGE_NAME,
        symbol,
        ts: new Date(item.T), // Trade happened timestamp
        px: item.p,
        sz: item.q,
        side,
        tradeType,
        tradeId: String(item.i),
        seq: message.seq,
        raw: { envelope: message, item },
      };

      events.push(event);
    }

    return events;
  }

  /**
   * Normalize mark price message to PriceEvent
   *
   * Extended format:
   * { type: "MP", data: { m, p, ts }, ts, seq, sourceEventId }
   */
  private normalizeMarkPrice(message: MarkPriceWsMessage, symbol: string): PriceEvent[] {
    if (!message.data.p) return [];

    const event: PriceEvent = {
      type: "price",
      priceType: "mark",
      exchange: EXCHANGE_NAME,
      symbol,
      ts: new Date(message.data.ts), // Price calculated timestamp
      markPx: message.data.p,
      indexPx: undefined,
      seq: message.seq,
      raw: message,
    };

    return [event];
  }

  /**
   * Normalize index price message to PriceEvent
   *
   * Extended format:
   * { type: "IP", data: { m, p, ts }, ts, seq, sourceEventId }
   */
  private normalizeIndexPrice(message: IndexPriceWsMessage, symbol: string): PriceEvent[] {
    if (!message.data.p) return [];

    const event: PriceEvent = {
      type: "price",
      priceType: "index",
      exchange: EXCHANGE_NAME,
      symbol,
      ts: new Date(message.data.ts), // Price calculated timestamp
      markPx: undefined,
      indexPx: message.data.p,
      seq: message.seq,
      raw: message,
    };

    return [event];
  }

  /**
   * Normalize funding rate message to FundingRateEvent
   *
   * Extended format:
   * { ts, data: { m, T, f }, seq }
   *
   * Note: MVP does not persist funding rates to DB,
   * but the event is converted and logged for observability.
   */
  private normalizeFundingRate(message: FundingRateWsMessage, symbol: string): FundingRateEvent[] {
    if (!message.data.f) return [];

    const event: FundingRateEvent = {
      type: "funding",
      exchange: EXCHANGE_NAME,
      symbol,
      ts: new Date(message.data.T), // Funding calculated+applied timestamp
      fundingRate: message.data.f,
      seq: message.seq,
      raw: message,
    };

    return [event];
  }
}
