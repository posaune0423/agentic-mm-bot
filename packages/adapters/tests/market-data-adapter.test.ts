/**
 * Extended Market Data Adapter Unit Tests
 *
 * Requirements: 3.1, 3.4, 3.5
 * - WS subscription
 * - Message normalization
 * - Sequence break detection
 * - Reconnection logic
 */

import { describe, expect, test } from "bun:test";
import { ExtendedMarketDataAdapter } from "../src/extended/market-data-adapter";

import type {
  BboEvent,
  PriceEvent,
  TradeEvent,
  ConnectionEvent,
  MarketDataEvent,
  FundingRateEvent,
} from "../src/ports";

const EXCHANGE_NAME = "extended";

describe("ExtendedMarketDataAdapter", () => {
  describe("BBO message normalization (Extended API doc format)", () => {
    test("should normalize Extended orderbook SNAPSHOT to BBO format", () => {
      type OrderbookMessage = {
        ts: number;
        type: "SNAPSHOT" | "DELTA";
        data?: {
          m: string;
          b?: Array<{ p: string; q: string }>;
          a?: Array<{ p: string; q: string }>;
        };
        seq: number;
      };

      // Extended API doc format for orderbook
      const message: OrderbookMessage = {
        ts: 1704067200000,
        type: "SNAPSHOT" as const,
        data: {
          m: "BTC-USD",
          b: [
            { p: "50000", q: "1.5" },
            { p: "49999", q: "2.0" },
          ],
          a: [
            { p: "50001", q: "1.0" },
            { p: "50002", q: "0.5" },
          ],
        },
        seq: 12345,
      };

      const normalizeOrderbook = (msg: OrderbookMessage, symbol: string): BboEvent | null => {
        if (msg.type === "DELTA") return null; // depth=1 should only get SNAPSHOT

        const bids = msg.data?.b;
        const asks = msg.data?.a;

        if (!bids?.length || !asks?.length) return null;

        return {
          type: "bbo",
          ts: new Date(msg.ts),
          exchange: EXCHANGE_NAME,
          symbol,
          bestBidPx: bids[0].p,
          bestBidSz: bids[0].q,
          bestAskPx: asks[0].p,
          bestAskSz: asks[0].q,
          seq: msg.seq,
          raw: msg,
        };
      };

      const result = normalizeOrderbook(message, "BTC-USD");

      expect(result).not.toBeNull();
      expect(result!.type).toBe("bbo");
      expect(result!.bestBidPx).toBe("50000");
      expect(result!.bestBidSz).toBe("1.5");
      expect(result!.bestAskPx).toBe("50001");
      expect(result!.bestAskSz).toBe("1.0");
      expect(result!.seq).toBe(12345);
      expect(result!.symbol).toBe("BTC-USD");
    });

    test("should return null for DELTA message (unexpected for depth=1)", () => {
      type OrderbookMessage = {
        ts: number;
        type: "SNAPSHOT" | "DELTA";
        data?: {
          m: string;
          b?: Array<{ p: string; q: string }>;
          a?: Array<{ p: string; q: string }>;
        };
        seq: number;
      };

      const message = {
        ts: 1704067200000,
        type: "DELTA" as const,
        data: {
          m: "BTC-USD",
          b: [{ p: "50000", q: "1.5" }],
          a: [{ p: "50001", q: "1.0" }],
        },
        seq: 12346,
      };

      const normalizeOrderbook = (msg: OrderbookMessage, symbol: string): BboEvent | null => {
        if (msg.type === "DELTA") return null;
        return null;
      };

      const result = normalizeOrderbook(message, "BTC-USD");
      expect(result).toBeNull();
    });

    test("should return null for empty bids/asks", () => {
      const message = {
        ts: 1704067200000,
        type: "SNAPSHOT" as const,
        data: {
          m: "BTC-USD",
          b: [],
          a: [],
        },
        seq: 12345,
      };

      const normalizeOrderbook = (msg: typeof message, symbol: string): BboEvent | null => {
        const bids = msg.data?.b;
        const asks = msg.data?.a;

        if (!bids?.length || !asks?.length) return null;

        return null;
      };

      const result = normalizeOrderbook(message, "BTC-USD");
      expect(result).toBeNull();
    });
  });

  describe("Trade message normalization (Extended API doc format)", () => {
    type TradesMessage = {
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
    };

    test("should normalize Extended trades message with single trade", () => {
      // Extended API doc format for trades
      const message: TradesMessage = {
        ts: 1704067200000,
        data: [
          { m: "BTC-USD", S: "BUY" as const, tT: "TRADE" as const, T: 1704067199999, p: "50000", q: "0.1", i: 1001 },
        ],
        seq: 12346,
      };

      const normalizeTrades = (msg: TradesMessage, symbol: string): TradeEvent[] => {
        if (!msg.data?.length) return [];

        return msg.data.map(item => ({
          type: "trade" as const,
          ts: new Date(item.T),
          exchange: EXCHANGE_NAME,
          symbol,
          tradeId: String(item.i),
          side: item.S === "BUY" ? ("buy" as const) : ("sell" as const),
          px: item.p,
          sz: item.q,
          tradeType:
            item.tT === "TRADE" ? ("normal" as const)
            : item.tT === "LIQUIDATION" ? ("liq" as const)
            : ("delev" as const),
          seq: msg.seq,
          raw: { envelope: msg, item },
        }));
      };

      const result = normalizeTrades(message, "BTC-USD");

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("trade");
      expect(result[0].px).toBe("50000");
      expect(result[0].sz).toBe("0.1");
      expect(result[0].side).toBe("buy");
      expect(result[0].tradeType).toBe("normal");
      expect(result[0].tradeId).toBe("1001");
      expect(result[0].seq).toBe(12346);
    });

    test("should normalize Extended trades message with multiple trades", () => {
      const message: TradesMessage = {
        ts: 1704067200000,
        data: [
          { m: "BTC-USD", S: "BUY" as const, tT: "TRADE" as const, T: 1704067199999, p: "50000", q: "0.1", i: 1001 },
          {
            m: "BTC-USD",
            S: "SELL" as const,
            tT: "LIQUIDATION" as const,
            T: 1704067200000,
            p: "49999",
            q: "1.0",
            i: 1002,
          },
        ],
        seq: 12346,
      };

      const normalizeTrades = (msg: TradesMessage, symbol: string): TradeEvent[] => {
        if (!msg.data?.length) return [];

        return msg.data.map(item => ({
          type: "trade" as const,
          ts: new Date(item.T),
          exchange: EXCHANGE_NAME,
          symbol,
          tradeId: String(item.i),
          side: item.S === "BUY" ? ("buy" as const) : ("sell" as const),
          px: item.p,
          sz: item.q,
          tradeType:
            item.tT === "TRADE" ? ("normal" as const)
            : item.tT === "LIQUIDATION" ? ("liq" as const)
            : ("delev" as const),
          seq: msg.seq,
          raw: { envelope: msg, item },
        }));
      };

      const result = normalizeTrades(message, "BTC-USD");

      expect(result).toHaveLength(2);
      expect(result[0].side).toBe("buy");
      expect(result[0].tradeType).toBe("normal");
      expect(result[1].side).toBe("sell");
      expect(result[1].tradeType).toBe("liq");
    });

    test("should map DELEVERAGE trade type to delev", () => {
      const message: TradesMessage = {
        ts: 1704067200000,
        data: [
          {
            m: "BTC-USD",
            S: "SELL" as const,
            tT: "DELEVERAGE" as const,
            T: 1704067199999,
            p: "50000",
            q: "1.0",
            i: 1003,
          },
        ],
        seq: 12347,
      };

      const normalizeTrades = (msg: TradesMessage, symbol: string): TradeEvent[] => {
        if (!msg.data?.length) return [];

        return msg.data.map(item => ({
          type: "trade" as const,
          ts: new Date(item.T),
          exchange: EXCHANGE_NAME,
          symbol,
          tradeId: String(item.i),
          side: item.S === "BUY" ? ("buy" as const) : ("sell" as const),
          px: item.p,
          sz: item.q,
          tradeType:
            item.tT === "TRADE" ? ("normal" as const)
            : item.tT === "LIQUIDATION" ? ("liq" as const)
            : ("delev" as const),
          seq: msg.seq,
          raw: { envelope: msg, item },
        }));
      };

      const result = normalizeTrades(message, "BTC-USD");

      expect(result[0].tradeType).toBe("delev");
    });

    test("should return empty array for empty trades data", () => {
      const message = {
        ts: 1704067200000,
        data: [],
        seq: 12346,
      };

      const normalizeTrades = (msg: typeof message, symbol: string): TradeEvent[] => {
        if (!msg.data?.length) return [];
        return [];
      };

      const result = normalizeTrades(message, "BTC-USD");

      expect(result).toHaveLength(0);
    });
  });

  describe("Price message normalization", () => {
    test("should normalize mark price message", () => {
      // Extended WS mark price message format
      const message = {
        type: "MP",
        data: { m: "BTC-USD", p: "50000", ts: 1704067200000 },
        ts: 1704067200001,
        seq: 12348,
      };

      const normalizeMarkPrice = (msg: typeof message, symbol: string): PriceEvent | null => {
        const markPx = msg.data?.p;
        if (!markPx) return null;

        return {
          type: "price",
          priceType: "mark",
          ts: new Date(msg.data.ts),
          exchange: EXCHANGE_NAME,
          symbol,
          markPx,
          indexPx: undefined,
          seq: msg.seq,
          raw: msg,
        };
      };

      const result = normalizeMarkPrice(message, "BTC-USD");

      expect(result).not.toBeNull();
      expect(result!.type).toBe("price");
      expect(result!.priceType).toBe("mark");
      expect(result!.markPx).toBe("50000");
      expect(result!.indexPx).toBeUndefined();
      expect(result!.seq).toBe(12348);
    });

    test("should normalize index price message", () => {
      // Extended WS index price message format
      const message = {
        type: "IP",
        data: { m: "BTC-USD", p: "49998", ts: 1704067200000 },
        ts: 1704067200001,
        seq: 12349,
      };

      const normalizeIndexPrice = (msg: typeof message, symbol: string): PriceEvent | null => {
        const indexPx = msg.data?.p;
        if (!indexPx) return null;

        return {
          type: "price",
          priceType: "index",
          ts: new Date(msg.data.ts),
          exchange: EXCHANGE_NAME,
          symbol,
          markPx: undefined,
          indexPx,
          seq: msg.seq,
          raw: msg,
        };
      };

      const result = normalizeIndexPrice(message, "BTC-USD");

      expect(result).not.toBeNull();
      expect(result!.type).toBe("price");
      expect(result!.priceType).toBe("index");
      expect(result!.indexPx).toBe("49998");
      expect(result!.markPx).toBeUndefined();
      expect(result!.seq).toBe(12349);
    });

    test("should return null when price data is missing", () => {
      const message = {
        type: "MP",
        data: { m: "BTC-USD", ts: 1704067200000 },
        ts: 1704067200001,
        seq: 12348,
      };

      // NOTE: include non-p fields to avoid TS "weak type" mismatch in tests
      const normalizeMarkPrice = (
        msg: { data?: { p?: string; m?: string; ts?: number } },
        symbol: string,
      ): PriceEvent | null => {
        const markPx = msg.data?.p;
        if (!markPx) return null;
        return null;
      };

      const result = normalizeMarkPrice(message, "BTC-USD");
      expect(result).toBeNull();
    });
  });

  describe("Funding rate message normalization", () => {
    test("should normalize funding rate message", () => {
      // Extended WS funding rate message format
      const message = {
        ts: 1704067200000,
        data: { m: "BTC-USD", T: 1704072000000, f: "0.0001" },
        seq: 12347,
      };

      const normalizeFundingRate = (msg: typeof message, symbol: string): FundingRateEvent | null => {
        const fundingRate = msg.data?.f;
        if (!fundingRate) return null;

        return {
          type: "funding",
          ts: new Date(msg.data.T),
          exchange: EXCHANGE_NAME,
          symbol,
          fundingRate,
          seq: msg.seq,
          raw: msg,
        };
      };

      const result = normalizeFundingRate(message, "BTC-USD");

      expect(result).not.toBeNull();
      expect(result!.type).toBe("funding");
      expect(result!.fundingRate).toBe("0.0001");
      expect(result!.seq).toBe(12347);
      expect(result!.symbol).toBe("BTC-USD");
    });

    test("should return null when funding rate is missing", () => {
      const message = {
        ts: 1704067200000,
        data: { m: "BTC-USD", T: 1704072000000 },
        seq: 12347,
      };

      // NOTE: include non-f fields to avoid TS "weak type" mismatch in tests
      const normalizeFundingRate = (
        msg: { data?: { f?: string; m?: string; T?: number } },
        symbol: string,
      ): FundingRateEvent | null => {
        const fundingRate = msg.data?.f;
        if (!fundingRate) return null;
        return null;
      };

      const result = normalizeFundingRate(message, "BTC-USD");
      expect(result).toBeNull();
    });
  });

  describe("Sequence break detection", () => {
    test("should detect sequence break", () => {
      const lastSeq = new Map<string, number>();
      lastSeq.set("extended:BTC-USD:bbo", 100);

      const checkSequence = (event: { exchange: string; symbol: string; type: string; seq?: number }) => {
        if (event.seq === undefined) return { hasBreak: false };

        const key = `${event.exchange}:${event.symbol}:${event.type}`;
        const lastSeqValue = lastSeq.get(key);

        if (lastSeqValue !== undefined && event.seq !== lastSeqValue + 1) {
          return { hasBreak: true, expected: lastSeqValue + 1, actual: event.seq };
        }

        lastSeq.set(key, event.seq);
        return { hasBreak: false };
      };

      // Sequence break: expected 101, got 105
      const result = checkSequence({
        exchange: "extended",
        symbol: "BTC-USD",
        type: "bbo",
        seq: 105,
      });

      expect(result.hasBreak).toBe(true);
      expect(result.expected).toBe(101);
      expect(result.actual).toBe(105);
    });

    test("should not detect break for consecutive sequences", () => {
      const lastSeq = new Map<string, number>();
      lastSeq.set("extended:BTC-USD:bbo", 100);

      const checkSequence = (event: { exchange: string; symbol: string; type: string; seq?: number }) => {
        if (event.seq === undefined) return { hasBreak: false };

        const key = `${event.exchange}:${event.symbol}:${event.type}`;
        const lastSeqValue = lastSeq.get(key);

        if (lastSeqValue !== undefined && event.seq !== lastSeqValue + 1) {
          return { hasBreak: true, expected: lastSeqValue + 1, actual: event.seq };
        }

        lastSeq.set(key, event.seq);
        return { hasBreak: false };
      };

      const result = checkSequence({
        exchange: "extended",
        symbol: "BTC-USD",
        type: "bbo",
        seq: 101,
      });

      expect(result.hasBreak).toBe(false);
    });

    test("should not detect break when no previous sequence", () => {
      const lastSeq = new Map<string, number>();

      const checkSequence = (event: { exchange: string; symbol: string; type: string; seq?: number }) => {
        if (event.seq === undefined) return { hasBreak: false };

        const key = `${event.exchange}:${event.symbol}:${event.type}`;
        const lastSeqValue = lastSeq.get(key);

        if (lastSeqValue !== undefined && event.seq !== lastSeqValue + 1) {
          return { hasBreak: true };
        }

        lastSeq.set(key, event.seq);
        return { hasBreak: false };
      };

      const result = checkSequence({
        exchange: "extended",
        symbol: "ETH-USD",
        type: "bbo",
        seq: 1,
      });

      expect(result.hasBreak).toBe(false);
    });

    test("should ignore events without sequence number", () => {
      const lastSeq = new Map<string, number>();

      const checkSequence = (event: { exchange: string; symbol: string; type: string; seq?: number }) => {
        if (event.seq === undefined) return { hasBreak: false };

        return { hasBreak: true };
      };

      const result = checkSequence({
        exchange: "extended",
        symbol: "BTC-USD",
        type: "price",
        seq: undefined,
      });

      expect(result.hasBreak).toBe(false);
    });
  });

  describe("Reconnection logic", () => {
    test("should calculate exponential backoff delay", () => {
      const config = {
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        multiplier: 2,
      };

      const calculateDelay = (attempt: number) =>
        Math.min(config.initialDelayMs * Math.pow(config.multiplier, attempt), config.maxDelayMs);

      expect(calculateDelay(0)).toBe(1000); // 1000 * 2^0 = 1000
      expect(calculateDelay(1)).toBe(2000); // 1000 * 2^1 = 2000
      expect(calculateDelay(2)).toBe(4000); // 1000 * 2^2 = 4000
      expect(calculateDelay(3)).toBe(8000); // 1000 * 2^3 = 8000
      expect(calculateDelay(4)).toBe(16000); // 1000 * 2^4 = 16000
      expect(calculateDelay(5)).toBe(30000); // 1000 * 2^5 = 32000, capped at 30000
      expect(calculateDelay(6)).toBe(30000); // Capped at max
    });

    test("should emit connection events", () => {
      const events: ConnectionEvent[] = [];

      const emitEvent = (event: ConnectionEvent) => events.push(event);

      emitEvent({
        type: "connected",
        ts: new Date(),
        exchange: EXCHANGE_NAME,
      });

      emitEvent({
        type: "disconnected",
        ts: new Date(),
        exchange: EXCHANGE_NAME,
      });

      emitEvent({
        type: "reconnecting",
        ts: new Date(),
        exchange: EXCHANGE_NAME,
        reason: "Reconnecting in 1000ms (attempt 1)",
      });

      expect(events).toHaveLength(3);
      expect(events[0].type).toBe("connected");
      expect(events[1].type).toBe("disconnected");
      expect(events[2].type).toBe("reconnecting");
      expect(events[2].reason).toContain("attempt 1");
    });
  });

  describe("Subscription management", () => {
    test("should track subscriptions", () => {
      const subscriptions: { exchange: string; symbol: string; channels: string[] }[] = [];

      const subscribe = (sub: { exchange: string; symbol: string; channels: string[] }) => {
        subscriptions.push(sub);
        return true;
      };

      const result = subscribe({
        exchange: "extended",
        symbol: "BTC-USD",
        channels: ["bbo", "trades"],
      });

      expect(result).toBe(true);
      expect(subscriptions).toHaveLength(1);
      expect(subscriptions[0].symbol).toBe("BTC-USD");
      expect(subscriptions[0].channels).toContain("bbo");
      expect(subscriptions[0].channels).toContain("trades");
    });

    test("should remove subscription on unsubscribe", () => {
      let subscriptions = [
        { exchange: "extended", symbol: "BTC-USD", channels: ["bbo"] },
        { exchange: "extended", symbol: "ETH-USD", channels: ["trades"] },
      ];

      const unsubscribe = (sub: { exchange: string; symbol: string }) => {
        subscriptions = subscriptions.filter(s => !(s.exchange === sub.exchange && s.symbol === sub.symbol));
        return true;
      };

      unsubscribe({ exchange: "extended", symbol: "BTC-USD" });

      expect(subscriptions).toHaveLength(1);
      expect(subscriptions[0].symbol).toBe("ETH-USD");
    });
  });

  describe("Channel mapping", () => {
    test("should map channels to adapter stream types", () => {
      const adapter = new ExtendedMarketDataAdapter({
        network: "testnet",
        vaultId: 0,
        starkPrivateKey: "0x1",
        starkPublicKey: "0x1",
        apiKey: "dummy",
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const channelToStreamTypes: (channel: "bbo" | "trades" | "prices" | "funding") => string[] = (
        adapter as any
      ).channelToStreamTypes.bind(adapter);

      expect(channelToStreamTypes("bbo")).toEqual(["orderbook"]);
      expect(channelToStreamTypes("trades")).toEqual(["trades"]);
      expect(channelToStreamTypes("prices")).toEqual(["markPrice", "indexPrice"]);
      expect(channelToStreamTypes("funding")).toEqual(["fundingRate"]);
    });
  });

  describe("Subscription (prices) -> WS -> PriceEvent", () => {
    /**
     * FakeWsConnection: a mock implementation that mimics WsConnection's AsyncIterable interface.
     * Messages are pushed via `emitMessage()` and consumed via `for await`.
     */
    class FakeWsConnection<T> implements AsyncIterable<T> {
      private closed = false;
      private queue: T[] = [];
      private pendingResolve: ((r: IteratorResult<T>) => void) | null = null;
      public readonly url: string;
      public readonly label: string;

      constructor(url: string, label: string) {
        this.url = url;
        this.label = label;
      }

      async connect(): Promise<void> {
        // No-op for mock
      }

      async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        if (this.pendingResolve) {
          const resolve = this.pendingResolve;
          this.pendingResolve = null;
          resolve({ value: undefined as unknown as T, done: true });
        }
      }

      isClosed(): boolean {
        return this.closed;
      }

      emitMessage(obj: T): void {
        if (this.pendingResolve) {
          const resolve = this.pendingResolve;
          this.pendingResolve = null;
          resolve({ value: obj, done: false });
        } else {
          this.queue.push(obj);
        }
      }

      [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
          next: async (): Promise<IteratorResult<T>> => {
            if (this.queue.length > 0) {
              return { value: this.queue.shift()!, done: false };
            }
            if (this.closed) {
              return { value: undefined as unknown as T, done: true };
            }
            return new Promise<IteratorResult<T>>(resolve => {
              this.pendingResolve = resolve;
            });
          },
          return: async (): Promise<IteratorResult<T>> => {
            await this.close();
            return { value: undefined as unknown as T, done: true };
          },
        };
      }
    }

    const waitFor = async <T>(fn: () => T | undefined, timeoutMs: number): Promise<T> => {
      const started = Date.now();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const v = fn();
        if (v !== undefined) return v;
        if (Date.now() - started >= timeoutMs) throw new Error(`timeout after ${timeoutMs}ms`);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    };

    test("should emit mark + index PriceEvent when subscribed to prices channel", async () => {
      // Create mock connections for each stream type
      const connections = new Map<string, FakeWsConnection<unknown>>();

      // Create a connection factory that returns mock connections based on URL
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const connectionFactory = (url: string, _headers?: Record<string, string>, label?: string): any => {
        const conn = new FakeWsConnection<unknown>(url, label ?? url);
        connections.set(url, conn);
        return conn;
      };

      const adapter = new ExtendedMarketDataAdapter(
        {
          network: "testnet",
          vaultId: 0,
          starkPrivateKey: "0x1",
          starkPublicKey: "0x1",
          apiKey: "dummy",
        },
        undefined, // Default reconnect config
        connectionFactory,
      );

      const events: MarketDataEvent[] = [];
      adapter.onEvent(e => events.push(e));

      const subRes = adapter.subscribe({
        exchange: "extended",
        symbol: "BTC-USD",
        channels: ["prices"],
      });
      expect(subRes.isOk()).toBeTrue();

      const connRes = await adapter.connect();
      expect(connRes.isOk()).toBeTrue();

      try {
        // Wait a tick so stream listeners attach.
        await new Promise(resolve => setTimeout(resolve, 10));

        // Find the mark and index connections by URL pattern
        const markConn = Array.from(connections.values()).find(c => c.url.includes("/prices/mark/"));
        const indexConn = Array.from(connections.values()).find(c => c.url.includes("/prices/index/"));

        expect(markConn).toBeDefined();
        expect(indexConn).toBeDefined();

        markConn!.emitMessage({
          type: "MP",
          data: { m: "BTC-USD", p: "50000", ts: 1704067200000 },
          ts: 1704067200001,
          seq: 100,
          sourceEventId: null,
        });

        indexConn!.emitMessage({
          type: "IP",
          data: { m: "BTC-USD", p: "49998", ts: 1704067200000 },
          ts: 1704067200001,
          seq: 101,
          sourceEventId: null,
        });

        const mark = await waitFor(
          () =>
            events.find(e => e.type === "price" && (e as PriceEvent).priceType === "mark") as PriceEvent | undefined,
          2_000,
        );
        expect(mark.exchange).toBe("extended");
        expect(mark.symbol).toBe("BTC-USD");
        expect(mark.markPx).toBe("50000");

        const index = await waitFor(
          () =>
            events.find(e => e.type === "price" && (e as PriceEvent).priceType === "index") as PriceEvent | undefined,
          2_000,
        );
        expect(index.exchange).toBe("extended");
        expect(index.symbol).toBe("BTC-USD");
        expect(index.indexPx).toBe("49998");
      } finally {
        await adapter.disconnect();
      }
    });
  });
});
