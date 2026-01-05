/**
 * MarketDataState Tests
 *
 * Requirements: 11.1, 6.1-6.5
 * - Track latest BBO/mark/index
 * - Maintain rolling windows for trades and mid snapshots
 * - Provide correct Snapshot for feature calculation
 */

import { describe, expect, it } from "bun:test";
import { MarketDataState } from "../src/data/market-data-state";
import type { MdBbo, MdPrice, MdTrade } from "@agentic-mm-bot/db";

// Helper to create mock BBO
function createMockBbo(ts: Date, bidPx: string, askPx: string): MdBbo {
  const bid = parseFloat(bidPx);
  const ask = parseFloat(askPx);
  const mid = ((bid + ask) / 2).toString();
  return {
    id: crypto.randomUUID(),
    ts,
    exchange: "test",
    symbol: "TEST-USD",
    bestBidPx: bidPx,
    bestBidSz: "10",
    bestAskPx: askPx,
    bestAskSz: "10",
    midPx: mid,
    seq: null,
    ingestTs: ts,
    rawJson: null,
  };
}

// Helper to create mock trade
function createMockTrade(
  ts: Date,
  px: string,
  sz: string,
  side?: "buy" | "sell",
): MdTrade {
  return {
    id: crypto.randomUUID(),
    ts,
    exchange: "test",
    symbol: "TEST-USD",
    tradeId: null,
    side: side ?? null,
    px,
    sz,
    type: null,
    seq: null,
    ingestTs: ts,
    rawJson: null,
  };
}

// Helper to create mock price
function createMockPrice(ts: Date, markPx?: string, indexPx?: string): MdPrice {
  return {
    id: crypto.randomUUID(),
    ts,
    exchange: "test",
    symbol: "TEST-USD",
    markPx: markPx ?? null,
    indexPx: indexPx ?? null,
    ingestTs: ts,
    rawJson: null,
  };
}

describe("MarketDataState", () => {
  describe("BBO updates", () => {
    it("should track latest BBO", () => {
      const state = new MarketDataState("test", "TEST-USD");

      state.updateBbo(createMockBbo(new Date(1000), "99", "101"));
      state.updateBbo(createMockBbo(new Date(2000), "100", "102"));

      const snapshot = state.getSnapshot(2000);

      expect(snapshot.bestBidPx).toBe("100");
      expect(snapshot.bestAskPx).toBe("102");
    });

    it("should add mid snapshots for volatility calculation", () => {
      const state = new MarketDataState("test", "TEST-USD");

      state.updateBbo(createMockBbo(new Date(1000), "99", "101"));
      state.updateBbo(createMockBbo(new Date(2000), "100", "102"));
      state.updateBbo(createMockBbo(new Date(3000), "101", "103"));

      const midSnapshots = state.getMidSnapshotsInWindow(3000, 10_000);

      expect(midSnapshots.length).toBe(3);
    });

    it("should report valid data after BBO update", () => {
      const state = new MarketDataState("test", "TEST-USD");

      expect(state.hasValidData()).toBe(false);

      state.updateBbo(createMockBbo(new Date(1000), "99", "101"));

      expect(state.hasValidData()).toBe(true);
    });
  });

  describe("price updates", () => {
    it("should track mark and index prices", () => {
      const state = new MarketDataState("test", "TEST-USD");

      state.updateBbo(createMockBbo(new Date(1000), "99", "101"));
      state.updatePrice(createMockPrice(new Date(1000), "100.5", "100.3"));

      const snapshot = state.getSnapshot(1000);

      expect(snapshot.markPx).toBe("100.5");
      expect(snapshot.indexPx).toBe("100.3");
    });
  });

  describe("trade tracking", () => {
    it("should track trades in window", () => {
      const state = new MarketDataState("test", "TEST-USD");

      state.addTrade(createMockTrade(new Date(1000), "100", "1", "buy"));
      state.addTrade(createMockTrade(new Date(2500), "101", "2", "sell"));
      state.addTrade(createMockTrade(new Date(3000), "99", "1.5", "buy"));

      const trades1s = state.getTradesInWindow(3000, 1000);
      const trades10s = state.getTradesInWindow(3000, 10_000);

      // trades1s includes trades from 2000ms to 3000ms (cutoff = 3000 - 1000 = 2000)
      // Trade at 2500ms and 3000ms are in window
      expect(trades1s.length).toBe(2);
      expect(trades10s.length).toBe(3);
    });
  });

  describe("data pruning", () => {
    it("should prune old trades", () => {
      const state = new MarketDataState("test", "TEST-USD");

      // Add trades at different times
      state.addTrade(createMockTrade(new Date(1000), "100", "1"));
      state.addTrade(createMockTrade(new Date(5000), "100", "1"));
      state.addTrade(createMockTrade(new Date(15000), "100", "1"));

      // Prune at 15000ms (10 second window)
      state.pruneOldData(15000);

      const trades = state.getAllTrades();

      // Only trades from 5000+ should remain
      expect(trades.length).toBe(2);
    });

    it("should prune old mid snapshots", () => {
      const state = new MarketDataState("test", "TEST-USD");

      state.updateBbo(createMockBbo(new Date(1000), "99", "101"));
      state.updateBbo(createMockBbo(new Date(5000), "100", "102"));
      state.updateBbo(createMockBbo(new Date(15000), "101", "103"));

      state.pruneOldData(15000);

      const midSnapshots = state.getMidSnapshotsInWindow(15000, 20_000);

      // Only snapshots from 5000+ should remain
      expect(midSnapshots.length).toBe(2);
    });
  });

  describe("snapshot generation", () => {
    it("should generate complete snapshot", () => {
      const state = new MarketDataState("test", "TEST-USD");

      state.updateBbo(createMockBbo(new Date(1000), "99.5", "100.5"));
      state.updatePrice(createMockPrice(new Date(1000), "100", "99.8"));

      const snapshot = state.getSnapshot(2000);

      expect(snapshot.exchange).toBe("test");
      expect(snapshot.symbol).toBe("TEST-USD");
      expect(snapshot.nowMs).toBe(2000);
      expect(snapshot.bestBidPx).toBe("99.5");
      expect(snapshot.bestAskPx).toBe("100.5");
      expect(snapshot.markPx).toBe("100");
      expect(snapshot.indexPx).toBe("99.8");
      expect(snapshot.lastUpdateMs).toBe(1000);
    });
  });
});
