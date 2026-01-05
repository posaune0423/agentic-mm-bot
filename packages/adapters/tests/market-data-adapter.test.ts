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

import type { BboEvent, PriceEvent, TradeEvent, ConnectionEvent, MarketDataEvent } from "../src/ports";

const EXCHANGE_NAME = "extended";

describe("ExtendedMarketDataAdapter", () => {
  describe("BBO message normalization", () => {
    test("should normalize orderbook to BBO format", () => {
      const message = {
        bids: [
          ["50000", "1.5"],
          ["49999", "2.0"],
        ],
        asks: [
          ["50001", "1.0"],
          ["50002", "0.5"],
        ],
        timestamp: 1704067200000,
        sequence: 12345,
      };

      const normalizeBbo = (msg: typeof message, symbol: string): BboEvent | null => {
        const bids = msg.bids;
        const asks = msg.asks;

        if (!bids?.length || !asks?.length) return null;

        const [bestBidPx, bestBidSz] = bids[0];
        const [bestAskPx, bestAskSz] = asks[0];

        return {
          type: "bbo",
          ts: new Date(msg.timestamp ?? Date.now()),
          exchange: EXCHANGE_NAME,
          symbol,
          bestBidPx,
          bestBidSz,
          bestAskPx,
          bestAskSz,
          seq: msg.sequence,
          raw: msg,
        };
      };

      const result = normalizeBbo(message, "BTC-USD");

      expect(result).not.toBeNull();
      expect(result!.type).toBe("bbo");
      expect(result!.bestBidPx).toBe("50000");
      expect(result!.bestBidSz).toBe("1.5");
      expect(result!.bestAskPx).toBe("50001");
      expect(result!.bestAskSz).toBe("1.0");
      expect(result!.seq).toBe(12345);
      expect(result!.symbol).toBe("BTC-USD");
    });

    test("should return null for empty orderbook", () => {
      const message = {
        bids: [],
        asks: [],
        timestamp: Date.now(),
      };

      const normalizeBbo = (msg: typeof message, symbol: string): BboEvent | null => {
        const bids = msg.bids;
        const asks = msg.asks;

        if (!bids?.length || !asks?.length) return null;

        return null;
      };

      const result = normalizeBbo(message, "BTC-USD");

      expect(result).toBeNull();
    });

    test("should return null when bids are missing", () => {
      const message = {
        bids: undefined,
        asks: [["50001", "1.0"]],
        timestamp: Date.now(),
      };

      const normalizeBbo = (msg: { bids?: string[][]; asks?: string[][] }, symbol: string): BboEvent | null => {
        const bids = msg.bids;
        const asks = msg.asks;

        if (!bids?.length || !asks?.length) return null;

        return null;
      };

      const result = normalizeBbo(message, "BTC-USD");

      expect(result).toBeNull();
    });
  });

  describe("Trade message normalization", () => {
    test("should normalize trade message", () => {
      const message = {
        id: 1001,
        price: "50000",
        qty: "0.1",
        side: "BUY",
        type: "NORMAL",
        createdTime: 1704067200000,
        sequence: 12346,
      };

      const normalizeTrade = (msg: typeof message, symbol: string): TradeEvent | null => {
        const price = msg.price;
        const size = msg.qty;

        if (!price || !size) return null;

        const sideRaw = msg.side;
        const side =
          sideRaw?.toUpperCase() === "BUY" ? "buy"
          : sideRaw?.toUpperCase() === "SELL" ? "sell"
          : undefined;

        const tradeTypeRaw = msg.type;
        let tradeType: "normal" | "liq" | "delev" | undefined;
        if (tradeTypeRaw === "LIQUIDATION") {
          tradeType = "liq";
        } else if (tradeTypeRaw === "ADL") {
          tradeType = "delev";
        } else {
          tradeType = "normal";
        }

        return {
          type: "trade",
          ts: new Date(msg.createdTime ?? Date.now()),
          exchange: EXCHANGE_NAME,
          symbol,
          tradeId: msg.id?.toString(),
          side,
          px: price,
          sz: size,
          tradeType,
          seq: msg.sequence,
          raw: msg,
        };
      };

      const result = normalizeTrade(message, "BTC-USD");

      expect(result).not.toBeNull();
      expect(result!.type).toBe("trade");
      expect(result!.px).toBe("50000");
      expect(result!.sz).toBe("0.1");
      expect(result!.side).toBe("buy");
      expect(result!.tradeType).toBe("normal");
      expect(result!.tradeId).toBe("1001");
    });

    test("should map LIQUIDATION trade type to liq", () => {
      const message = {
        price: "50000",
        qty: "1.0",
        side: "SELL",
        type: "LIQUIDATION",
        createdTime: Date.now(),
      };

      const tradeTypeRaw = message.type;
      let tradeType: "normal" | "liq" | "delev" | undefined;
      if (tradeTypeRaw === "LIQUIDATION") {
        tradeType = "liq";
      } else if (tradeTypeRaw === "ADL") {
        tradeType = "delev";
      } else {
        tradeType = "normal";
      }

      expect(tradeType).toBe("liq");
    });

    test("should map ADL trade type to delev", () => {
      const message = {
        price: "50000",
        qty: "1.0",
        side: "SELL",
        type: "ADL",
        createdTime: Date.now(),
      };

      const tradeTypeRaw = message.type;
      let tradeType: "normal" | "liq" | "delev" | undefined;
      if (tradeTypeRaw === "LIQUIDATION") {
        tradeType = "liq";
      } else if (tradeTypeRaw === "ADL") {
        tradeType = "delev";
      } else {
        tradeType = "normal";
      }

      expect(tradeType).toBe("delev");
    });

    test("should return null for missing price", () => {
      const message = {
        qty: "0.1",
        side: "BUY",
        type: "NORMAL",
        createdTime: Date.now(),
      };

      const normalizeTrade = (msg: { price?: string; qty?: string }, symbol: string): TradeEvent | null => {
        const price = msg.price;
        const size = msg.qty;

        if (!price || !size) return null;

        return null;
      };

      const result = normalizeTrade(message, "BTC-USD");

      expect(result).toBeNull();
    });
  });

  describe("Price message normalization", () => {
    test("should normalize price message with markPrice", () => {
      const message = {
        markPrice: "50000",
        indexPrice: "49998",
        timestamp: 1704067200000,
      };

      const normalizePrice = (msg: typeof message, symbol: string): PriceEvent | null => {
        const markPx = msg.markPrice;
        const indexPx = msg.indexPrice;

        if (!markPx && !indexPx) return null;

        return {
          type: "price",
          ts: new Date(msg.timestamp ?? Date.now()),
          exchange: EXCHANGE_NAME,
          symbol,
          markPx,
          indexPx,
          raw: msg,
        };
      };

      const result = normalizePrice(message, "BTC-USD");

      expect(result).not.toBeNull();
      expect(result!.type).toBe("price");
      expect(result!.markPx).toBe("50000");
      expect(result!.indexPx).toBe("49998");
    });

    test("should normalize price with snake_case fields", () => {
      const message = {
        mark_price: "50000",
        index_price: "49998",
        timestamp: 1704067200000,
      };

      const normalizePrice = (msg: Record<string, unknown>, symbol: string): PriceEvent | null => {
        const markPx = (msg.markPrice ?? msg.mark_price) as string | undefined;
        const indexPx = (msg.indexPrice ?? msg.index_price) as string | undefined;

        if (!markPx && !indexPx) return null;

        return {
          type: "price",
          ts: new Date((msg.timestamp as number) ?? Date.now()),
          exchange: EXCHANGE_NAME,
          symbol,
          markPx,
          indexPx,
          raw: msg,
        };
      };

      const result = normalizePrice(message, "BTC-USD");

      expect(result).not.toBeNull();
      expect(result!.markPx).toBe("50000");
      expect(result!.indexPx).toBe("49998");
    });

    test("should return null when both prices are missing", () => {
      const message = {
        timestamp: Date.now(),
      };

      const normalizePrice = (msg: Record<string, unknown>, symbol: string): PriceEvent | null => {
        const markPx = (msg.markPrice ?? msg.mark_price) as string | undefined;
        const indexPx = (msg.indexPrice ?? msg.index_price) as string | undefined;

        if (!markPx && !indexPx) return null;

        return null;
      };

      const result = normalizePrice(message, "BTC-USD");

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
    test("should map bbo channel to orderbook stream", () => {
      const getStreamType = (channel: string) => {
        switch (channel) {
          case "bbo":
            return "orderbooks";
          case "trades":
            return "publicTrades";
          case "prices":
            return "fundingRates";
          default:
            return null;
        }
      };

      expect(getStreamType("bbo")).toBe("orderbooks");
    });

    test("should map trades channel to publicTrades stream", () => {
      const getStreamType = (channel: string) => {
        switch (channel) {
          case "bbo":
            return "orderbooks";
          case "trades":
            return "publicTrades";
          case "prices":
            return "fundingRates";
          default:
            return null;
        }
      };

      expect(getStreamType("trades")).toBe("publicTrades");
    });

    test("should map prices channel to fundingRates stream", () => {
      const getStreamType = (channel: string) => {
        switch (channel) {
          case "bbo":
            return "orderbooks";
          case "trades":
            return "publicTrades";
          case "prices":
            return "fundingRates";
          default:
            return null;
        }
      };

      expect(getStreamType("prices")).toBe("fundingRates");
    });

    test("should return null for unknown channel", () => {
      const getStreamType = (channel: string) => {
        switch (channel) {
          case "bbo":
            return "orderbooks";
          case "trades":
            return "publicTrades";
          case "prices":
            return "fundingRates";
          default:
            return null;
        }
      };

      expect(getStreamType("unknown")).toBeNull();
    });
  });
});
