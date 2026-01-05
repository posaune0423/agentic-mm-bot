/**
 * Database Schema Integration Tests
 *
 * Requirements: 12.3, 14.2
 * - Verify migrations apply correctly
 * - Verify basic insert/upsert operations
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, and } from "drizzle-orm";
import {
  mdBbo,
  mdTrade,
  mdPrice,
  latestTop,
  exFill,
  exOrderEvent,
  strategyState,
  fillsEnriched,
  type NewMdBbo,
  type NewMdTrade,
  type NewMdPrice,
  type NewLatestTop,
  type NewExFill,
  type NewExOrderEvent,
  type NewStrategyState,
} from "../../src";

// Test database URL - should point to a test database
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe("Database Schema Integration", () => {
  let pool: Pool;
  let db: NodePgDatabase;

  beforeAll(async () => {
    if (!TEST_DATABASE_URL) {
      throw new Error("TEST_DATABASE_URL or DATABASE_URL must be set");
    }

    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    db = drizzle(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("md_bbo table", () => {
    it("should insert a BBO record", async () => {
      const testBbo: NewMdBbo = {
        ts: new Date(),
        exchange: "extended",
        symbol: "BTC-USD",
        bestBidPx: "50000.00",
        bestBidSz: "1.5",
        bestAskPx: "50010.00",
        bestAskSz: "2.0",
        midPx: "50005.00",
        seq: 12345,
      };

      const result = await db.insert(mdBbo).values(testBbo).returning();

      expect(result).toHaveLength(1);
      expect(result[0].exchange).toBe("extended");
      expect(result[0].symbol).toBe("BTC-USD");
      expect(result[0].bestBidPx).toBe("50000.00");

      // Clean up
      await db.delete(mdBbo).where(eq(mdBbo.id, result[0].id));
    });
  });

  describe("md_trade table", () => {
    it("should insert a trade record", async () => {
      const testTrade: NewMdTrade = {
        ts: new Date(),
        exchange: "extended",
        symbol: "BTC-USD",
        tradeId: "trade-123",
        side: "buy",
        px: "50005.00",
        sz: "0.5",
        type: "normal",
      };

      const result = await db.insert(mdTrade).values(testTrade).returning();

      expect(result).toHaveLength(1);
      expect(result[0].side).toBe("buy");
      expect(result[0].type).toBe("normal");

      // Clean up
      await db.delete(mdTrade).where(eq(mdTrade.id, result[0].id));
    });
  });

  describe("md_price table", () => {
    it("should insert a price record", async () => {
      const testPrice: NewMdPrice = {
        ts: new Date(),
        exchange: "extended",
        symbol: "BTC-USD",
        markPx: "50000.00",
        indexPx: "49995.00",
      };

      const result = await db.insert(mdPrice).values(testPrice).returning();

      expect(result).toHaveLength(1);
      expect(result[0].markPx).toBe("50000.00");
      expect(result[0].indexPx).toBe("49995.00");

      // Clean up
      await db.delete(mdPrice).where(eq(mdPrice.id, result[0].id));
    });
  });

  describe("latest_top table", () => {
    it("should upsert latest top data", async () => {
      const testTop: NewLatestTop = {
        exchange: "extended",
        symbol: "TEST-UPSERT",
        ts: new Date(),
        bestBidPx: "100.00",
        bestBidSz: "1.0",
        bestAskPx: "101.00",
        bestAskSz: "1.0",
        midPx: "100.50",
      };

      // First insert
      await db
        .insert(latestTop)
        .values(testTop)
        .onConflictDoUpdate({
          target: [latestTop.exchange, latestTop.symbol],
          set: {
            ts: testTop.ts,
            bestBidPx: testTop.bestBidPx,
            bestBidSz: testTop.bestBidSz,
            bestAskPx: testTop.bestAskPx,
            bestAskSz: testTop.bestAskSz,
            midPx: testTop.midPx,
            updatedAt: new Date(),
          },
        });

      // Update
      const updatedTop = {
        ...testTop,
        bestBidPx: "99.00",
        ts: new Date(),
      };

      await db
        .insert(latestTop)
        .values(updatedTop)
        .onConflictDoUpdate({
          target: [latestTop.exchange, latestTop.symbol],
          set: {
            ts: updatedTop.ts,
            bestBidPx: updatedTop.bestBidPx,
            bestBidSz: updatedTop.bestBidSz,
            bestAskPx: updatedTop.bestAskPx,
            bestAskSz: updatedTop.bestAskSz,
            midPx: updatedTop.midPx,
            updatedAt: new Date(),
          },
        });

      // Verify
      const result = await db
        .select()
        .from(latestTop)
        .where(and(eq(latestTop.exchange, "extended"), eq(latestTop.symbol, "TEST-UPSERT")));

      expect(result).toHaveLength(1);
      expect(result[0].bestBidPx).toBe("99.00");

      // Clean up
      await db.delete(latestTop).where(and(eq(latestTop.exchange, "extended"), eq(latestTop.symbol, "TEST-UPSERT")));
    });
  });

  describe("ex_order_event table", () => {
    it("should insert an order event", async () => {
      const testEvent: NewExOrderEvent = {
        ts: new Date(),
        exchange: "extended",
        symbol: "BTC-USD",
        clientOrderId: "test-order-123",
        exchangeOrderId: "ex-order-456",
        eventType: "place",
        side: "buy",
        px: "50000.00",
        sz: "0.1",
        postOnly: true,
      };

      const result = await db.insert(exOrderEvent).values(testEvent).returning();

      expect(result).toHaveLength(1);
      expect(result[0].eventType).toBe("place");
      expect(result[0].postOnly).toBe(true);

      // Clean up
      await db.delete(exOrderEvent).where(eq(exOrderEvent.id, result[0].id));
    });
  });

  describe("ex_fill table", () => {
    it("should insert a fill record", async () => {
      const testFill: NewExFill = {
        ts: new Date(),
        exchange: "extended",
        symbol: "BTC-USD",
        clientOrderId: "test-order-123",
        exchangeOrderId: "ex-order-456",
        side: "buy",
        fillPx: "50000.00",
        fillSz: "0.1",
        fee: "0.50",
        liquidity: "maker",
        state: "NORMAL",
        paramsSetId: "00000000-0000-0000-0000-000000000001",
      };

      const result = await db.insert(exFill).values(testFill).returning();

      expect(result).toHaveLength(1);
      expect(result[0].side).toBe("buy");
      expect(result[0].liquidity).toBe("maker");
      expect(result[0].state).toBe("NORMAL");

      // Clean up
      await db.delete(exFill).where(eq(exFill.id, result[0].id));
    });
  });

  describe("strategy_state table", () => {
    it("should insert a strategy state snapshot", async () => {
      const testState: NewStrategyState = {
        ts: new Date(),
        exchange: "extended",
        symbol: "BTC-USD",
        mode: "PAUSE",
        modeSince: new Date(),
        pauseUntil: null,
      };

      const result = await db.insert(strategyState).values(testState).returning();

      expect(result).toHaveLength(1);
      expect(result[0].mode).toBe("PAUSE");

      // Clean up
      await db.delete(strategyState).where(eq(strategyState.id, result[0].id));
    });
  });
});
