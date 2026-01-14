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

type StreamClientWithMarkPrice = {
  subscribeToMarkPrice: (marketName?: string) => PerpetualStreamConnection<unknown>;
};

type StreamClientWithIndexPrice = {
  subscribeToIndexPrice: (marketName?: string) => PerpetualStreamConnection<unknown>;
};

function hasSubscribeToMarkPrice(
  client: PerpetualStreamClient,
): client is PerpetualStreamClient & StreamClientWithMarkPrice {
  return typeof (client as unknown as Record<string, unknown>)["subscribeToMarkPrice"] === "function";
}

function hasSubscribeToIndexPrice(
  client: PerpetualStreamClient,
): client is PerpetualStreamClient & StreamClientWithIndexPrice {
  return typeof (client as unknown as Record<string, unknown>)["subscribeToIndexPrice"] === "function";
}

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
  private disabledStreamTypes: Set<StreamType> = new Set();
  private reconnectConfig: ReconnectConfig;
  private reconnectAttempt = 0;
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastSeq: Map<string, number> = new Map();
  private lastTopOfBook: Map<string, { bid?: { p: string; q: string }; ask?: { p: string; q: string } }> = new Map();
  /**
   * Orderbook state for deriving BBO from SNAPSHOT+DELTA.
   *
   * We cannot assume DELTA payloads are top-of-book or sorted. We maintain a small in-memory book:
   * - price -> qty for bids/asks
   * - qty<=0 deletes a level
   * - bestBid = max(bid prices), bestAsk = min(ask prices)
   */
  private orderbooks: Map<string, { bids: Map<string, string>; asks: Map<string, string> }> = new Map();
  private isConnected_ = false;
  private isReconnecting_ = false;

  static initialize(): Promise<void> {
    // NOTE:
    // The Extended SDK ships a WASM bundle for signing. However, market-data streaming
    // does not require signing. Some published SDK builds have been missing the WASM
    // artifacts, causing local dev to crash on init.
    //
    // We keep this method for call-site compatibility, but it's intentionally a no-op.
    return Promise.resolve();
  }

  constructor(config: ExtendedConfig, reconnectConfig: ReconnectConfig = DEFAULT_RECONNECT_CONFIG) {
    this.config = config;
    this.endpointConfig = config.network === "mainnet" ? MAINNET_CONFIG : TESTNET_CONFIG;
    this.streamClient = new PerpetualStreamClient({ apiUrl: this.endpointConfig.streamUrl });
    this.reconnectConfig = reconnectConfig;

    // Feature-detect optional streams (SDK versions may differ).
    // Note: As of extended-typescript-sdk@0.0.7, subscribeToMarkPrice and subscribeToIndexPrice
    // are NOT available. The exchange API supports these streams but the SDK hasn't wrapped them yet.
    if (!hasSubscribeToMarkPrice(this.streamClient)) {
      this.disabledStreamTypes.add("markPrice");
      log.warn("Mark price stream not available in SDK - subscribeToMarkPrice method missing");
    }
    if (!hasSubscribeToIndexPrice(this.streamClient)) {
      this.disabledStreamTypes.add("indexPrice");
      log.warn("Index price stream not available in SDK - subscribeToIndexPrice method missing");
    }
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

    // Clear sequence tracking so a reconnect doesn't immediately trip seq-break.
    this.lastSeq.clear();
    this.lastTopOfBook.clear();

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
        if (this.disabledStreamTypes.has(streamType)) continue;
        const key = `${symbol}:${streamType}`;

        if (this.activeStreams.has(key)) continue;

        try {
          await this.startStream(symbol, streamType);
        } catch (error) {
          log.warn(`Failed to start ${streamType} stream for ${symbol}`, { error });
          // If optional price streams fail, disable them and keep other streams alive.
          if (streamType === "markPrice" || streamType === "indexPrice") {
            this.disabledStreamTypes.add(streamType);
            continue;
          }

          // Non-optional streams: reconnect whole adapter.
          this.scheduleReconnect("start_stream_failed", {
            symbol,
            streamType,
            errorType: error instanceof Error ? error.name : typeof error,
          });
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
        // SDK supports mark/index price streams.
        return ["markPrice", "indexPrice"];
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
        // NOTE:
        // extended-typescript-sdk@0.0.1 includes a `depth` query param which the testnet orderbooks
        // endpoint currently doesn't emit data for. Omitting `depth` yields a SNAPSHOT immediately.
        // We only need BBO, so we'll take the first bid/ask from the snapshot.
        return this.streamClient.subscribeToOrderbooks({
          marketName: symbol,
        });
      case "trades":
        return this.streamClient.subscribeToPublicTrades(symbol);
      case "fundingRate":
        return this.streamClient.subscribeToFundingRates(symbol);
      case "markPrice":
        return hasSubscribeToMarkPrice(this.streamClient) ? this.streamClient.subscribeToMarkPrice(symbol) : null;
      case "indexPrice":
        return hasSubscribeToIndexPrice(this.streamClient) ? this.streamClient.subscribeToIndexPrice(symbol) : null;
      default:
        return null;
    }
  }

  private async listenStream(state: StreamState): Promise<void> {
    const { streamType } = state;

    // For markPrice, indexPrice, and fundingRate: prefer AsyncIterable (SDK's native pattern)
    // to avoid issues where connection.websocket is not exposed.
    const useAsyncIterable = streamType === "markPrice" || streamType === "indexPrice" || streamType === "fundingRate";

    if (useAsyncIterable) {
      await this.listenStreamAsyncIterable(state);
    } else {
      await this.listenStreamWebsocket(state);
    }
  }

  /**
   * Listen to a stream using the SDK's AsyncIterable pattern (for await ... of connection).
   * This is the preferred approach for markPrice, indexPrice, fundingRate streams.
   */
  private async listenStreamAsyncIterable(state: StreamState): Promise<void> {
    const { streamType, symbol } = state;

    try {
      let sawFirstNormalized = false;

      log.info(`Starting AsyncIterable listener for ${streamType}`, { symbol });

      // The SDK's PerpetualStreamConnection implements AsyncIterable
      const iterable = state.connection as unknown as AsyncIterable<unknown>;

      for await (const message of iterable) {
        if (!state.isRunning || state.connection.isClosed()) break;

        const events = this.normalizeMessage(message, streamType, symbol);

        if (!sawFirstNormalized && events.length > 0) {
          sawFirstNormalized = true;
          const types = Array.from(new Set(events.map(e => e.type))).slice(0, 8);
          log.info("First normalized market data events received (AsyncIterable)", { symbol, streamType, types });
        }

        for (const event of events) {
          const seqBreak = this.checkSequence(event, streamType);

          if (seqBreak) {
            // For mark/index, reconnect immediately on sequence break
            if (streamType === "markPrice" || streamType === "indexPrice") {
              log.warn(`Sequence break on ${streamType}, triggering reconnect`, {
                expected: seqBreak.expected,
                actual: seqBreak.actual,
              });
              this.scheduleReconnect("seq_break", {
                symbol,
                streamType,
                expected: seqBreak.expected,
                actual: seqBreak.actual,
              });
              return;
            } else {
              // For funding, just log (non-critical)
              log.warn(`Sequence gap on ${streamType} (non-critical)`, {
                expected: seqBreak.expected,
                actual: seqBreak.actual,
              });
            }
          }

          this.emitEvent(event);
        }
      }

      // Iterator completed
      if (state.isRunning) {
        log.warn(`Stream ${streamType} ended unexpectedly (AsyncIterable completed)`, { symbol });
        this.handleDisconnect("asynciterable_completed", { symbol, streamType });
      }
    } catch (error) {
      if (state.isRunning) {
        log.warn(`Stream ${streamType} disconnected (AsyncIterable)`, { error });
        this.handleDisconnect("asynciterable_threw", {
          symbol,
          streamType,
          errorType: error instanceof Error ? error.name : typeof error,
        });
      }
    }
  }

  /**
   * Listen to a stream using direct websocket access with buffering.
   * This approach is used for orderbook and trades to avoid message drops.
   */
  private async listenStreamWebsocket(state: StreamState): Promise<void> {
    const { streamType, symbol } = state;

    try {
      let sawFirstMessage = false;
      let sawFirstNormalized = false;
      // NOTE:
      // The SDK's `PerpetualStreamConnection.receive()` uses `websocket.once('message', ...)` per recv(),
      // and the UnifiedWebSocket emits messages synchronously to currently-registered listeners.
      // If multiple messages are emitted in the same tick, messages can be dropped between `once` calls.
      //
      // To avoid that, attach a persistent listener to the SDK's internal websocket and buffer messages.
      const anyConn = state.connection as unknown as { websocket?: unknown };
      const ws = anyConn.websocket as
        | {
            on: (event: string, listener: (data: unknown) => void) => void;
            off: (event: string, listener: (data: unknown) => void) => void;
            readyState: number;
            OPEN: number;
            CLOSED: number;
          }
        | undefined;

      // If websocket is not available, fall back to AsyncIterable
      if (!ws) {
        log.info(`Websocket not exposed for ${streamType}, falling back to AsyncIterable`, { symbol });
        await this.listenStreamAsyncIterable(state);
        return;
      }

      let wsClosed = false;
      const queue: unknown[] = [];
      let pending: { resolve: (v: unknown) => void; reject: (e: unknown) => void } | null = null;

      const wake = () => {
        if (pending && queue.length > 0) {
          const { resolve } = pending;
          pending = null;
          resolve(queue.shift());
          return;
        }
        if (pending && wsClosed) {
          const { reject } = pending;
          pending = null;
          reject(new Error("ws closed"));
        }
      };

      const onMessage = (data: unknown) => {
        try {
          const raw =
            typeof data === "string" ? data : (
              ((data as { toString?: () => string } | null | undefined)?.toString?.() ?? String(data))
            );
          queue.push(JSON.parse(raw) as unknown);
          wake();
        } catch {
          // ignore parse errors (we'll rely on stream_threw / staleness signals)
        }
      };

      const onClose = () => {
        wsClosed = true;
        wake();
      };

      ws.on("message", onMessage);
      ws.on("close", onClose);

      const nextMessage = async (): Promise<unknown> => {
        if (queue.length > 0) return queue.shift()!;
        if (wsClosed) throw new Error("ws closed");
        return await new Promise<unknown>((resolve, reject) => {
          pending = { resolve, reject };
        });
      };

      while (state.isRunning && !state.connection.isClosed()) {
        const message = await nextMessage();

        if (!sawFirstMessage) {
          sawFirstMessage = true;
        }

        const events = this.normalizeMessage(message, streamType, symbol);

        if (!sawFirstNormalized) {
          sawFirstNormalized = true;
          const types = Array.from(new Set(events.map(e => e.type))).slice(0, 8);
          log.info("First normalized market data events received", { symbol, streamType, types });
        }

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
              this.scheduleReconnect("seq_break", {
                symbol,
                streamType,
                expected: seqBreak.expected,
                actual: seqBreak.actual,
              });
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

      ws.off("message", onMessage);
      ws.off("close", onClose);

      // Some SDK iterators may end "cleanly" on disconnect (no throw).
      // Treat an unexpected end as a disconnect and trigger reconnection.
      if (state.isRunning) {
        log.warn(`Stream ${streamType} ended unexpectedly (iterator completed)`, { symbol });
        this.handleDisconnect("iterator_completed", { symbol, streamType });
      }
    } catch (error) {
      if (state.isRunning) {
        log.warn(`Stream ${streamType} disconnected`, { error });
        this.handleDisconnect("stream_threw", {
          symbol,
          streamType,
          errorType: error instanceof Error ? error.name : typeof error,
        });
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

  private handleDisconnect(reason?: string, meta?: Record<string, unknown>): void {
    // Mark connection as down so dashboards/consumers don't think we're healthy.
    this.isConnected_ = false;

    this.emitEvent({
      type: "disconnected",
      ts: new Date(),
      exchange: EXCHANGE_NAME,
    });

    this.scheduleReconnect(reason ?? "handleDisconnect", meta);
  }

  private scheduleReconnect(reason?: string, meta?: Record<string, unknown>): void {
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
      reason: `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt}) - ${reason ?? "unknown"}`,
    });

    log.info(`Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempt})`, { reason, meta });

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

    // Some streams (notably trades) can yield multiple normalized events from a single envelope,
    // all sharing the same `seq`. Treat duplicates as non-issues to avoid noisy false positives.
    if (lastSeq !== undefined && event.seq === lastSeq) {
      return null;
    }

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
    // In practice, the orderbook stream can emit a SNAPSHOT followed by DELTAs.
    // Since we only need BBO, we can treat both message types as "top-of-book updates".
    // Some DELTA payloads may omit one side; in that case, carry forward the last known value.
    const bids = message.data.b;
    const asks = message.data.a;

    // Maintain a small per-symbol orderbook so DELTAs can't corrupt BBO.
    let book = this.orderbooks.get(symbol);
    if (!book) {
      book = { bids: new Map(), asks: new Map() };
      this.orderbooks.set(symbol, book);
    }

    const isPositive = (q: string): boolean => {
      const n = parseFloat(q);
      return Number.isFinite(n) && n > 0;
    };

    const upsertSide = (side: "bids" | "asks", levels: Array<{ p: string; q: string }>) => {
      const m = side === "bids" ? book.bids : book.asks;
      for (const lvl of levels) {
        if (!lvl.p) continue;
        if (!lvl.q || !isPositive(lvl.q)) {
          m.delete(lvl.p);
        } else {
          m.set(lvl.p, lvl.q);
        }
      }
    };

    if (message.type === "SNAPSHOT") {
      book.bids.clear();
      book.asks.clear();
      upsertSide("bids", bids);
      upsertSide("asks", asks);
    } else {
      upsertSide("bids", bids);
      upsertSide("asks", asks);
    }

    // Keep memory bounded: retain top N levels by price.
    const MAX_LEVELS = 200;
    const prune = (side: "bids" | "asks") => {
      const m = side === "bids" ? book.bids : book.asks;
      if (m.size <= MAX_LEVELS) return;
      const prices = Array.from(m.keys())
        .map(p => ({ p, n: parseFloat(p) }))
        .filter(x => Number.isFinite(x.n));
      prices.sort((a, b) => (side === "bids" ? b.n - a.n : a.n - b.n));
      const keep = new Set(prices.slice(0, MAX_LEVELS).map(x => x.p));
      for (const p of m.keys()) {
        if (!keep.has(p)) m.delete(p);
      }
    };
    prune("bids");
    prune("asks");

    const bestBidPx =
      Array.from(book.bids.keys())
        .map(p => ({ p, n: parseFloat(p) }))
        .filter(x => Number.isFinite(x.n))
        .sort((a, b) => b.n - a.n)[0]?.p ?? null;
    const bestAskPx =
      Array.from(book.asks.keys())
        .map(p => ({ p, n: parseFloat(p) }))
        .filter(x => Number.isFinite(x.n))
        .sort((a, b) => a.n - b.n)[0]?.p ?? null;

    const bestBid = bestBidPx ? { p: bestBidPx, q: book.bids.get(bestBidPx) ?? "0" } : undefined;
    const bestAsk = bestAskPx ? { p: bestAskPx, q: book.asks.get(bestAskPx) ?? "0" } : undefined;

    // Fallback to last known good if one side temporarily missing.
    const prev = this.lastTopOfBook.get(symbol) ?? {};
    const bidFinal = bestBid ?? prev.bid;
    const askFinal = bestAsk ?? prev.ask;

    // Guard: if book becomes crossed (bid >= ask), do not emit a corrupted BBO.
    // Prefer previous non-crossed top-of-book if available.
    if (bidFinal && askFinal) {
      const bidNum = parseFloat(bidFinal.p);
      const askNum = parseFloat(askFinal.p);
      if (Number.isFinite(bidNum) && Number.isFinite(askNum) && bidNum >= askNum) {
        // If previous is sane, use it; otherwise drop this event.
        if (prev.bid && prev.ask) {
          const pb = parseFloat(prev.bid.p);
          const pa = parseFloat(prev.ask.p);
          if (Number.isFinite(pb) && Number.isFinite(pa) && pb < pa) {
            // Keep cache sane by restoring previous.
            this.lastTopOfBook.set(symbol, { bid: prev.bid, ask: prev.ask });
            return [
              {
                type: "bbo",
                exchange: EXCHANGE_NAME,
                symbol,
                ts: new Date(message.ts),
                bestBidPx: prev.bid.p,
                bestBidSz: prev.bid.q,
                bestAskPx: prev.ask.p,
                bestAskSz: prev.ask.q,
                seq: message.seq,
                raw: message,
              },
            ];
          }
        }
        return [];
      }
    }

    if (bidFinal || askFinal) {
      this.lastTopOfBook.set(symbol, { bid: bidFinal, ask: askFinal });
    }

    if (!bidFinal || !askFinal) return [];

    const event: BboEvent = {
      type: "bbo",
      exchange: EXCHANGE_NAME,
      symbol,
      ts: new Date(message.ts),
      bestBidPx: bidFinal.p,
      bestBidSz: bidFinal.q,
      bestAskPx: askFinal.p,
      bestAskSz: askFinal.q,
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
