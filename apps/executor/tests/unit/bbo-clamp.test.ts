/**
 * BBO Clamping Unit Tests
 *
 * Tests for the price clamping logic that prevents post-only rejections
 * by ensuring prices don't cross the BBO (best bid/ask).
 */

import { describe, expect, test } from "bun:test";

/**
 * Clamp price to avoid crossing the BBO (post-only protection).
 *
 * - BUY: if price >= bestAsk, clamp to bestBid
 * - SELL: if price <= bestBid, clamp to bestAsk
 *
 * This mirrors the logic in decision-cycle.ts
 */
function clampPriceToBbo(
  side: "buy" | "sell",
  price: string,
  bestBidPx: string,
  bestAskPx: string,
): { adjustedPrice: string; clamped: boolean } {
  const priceNum = Number.parseFloat(price);
  const bestBid = Number.parseFloat(bestBidPx);
  const bestAsk = Number.parseFloat(bestAskPx);

  // Guard: if BBO is invalid, return original price
  if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk) || bestBid <= 0 || bestAsk <= 0) {
    return { adjustedPrice: price, clamped: false };
  }

  if (side === "buy") {
    // BUY order would cross if price >= bestAsk
    if (priceNum >= bestAsk) {
      return { adjustedPrice: bestBidPx, clamped: true };
    }
  } else {
    // SELL order would cross if price <= bestBid
    if (priceNum <= bestBid) {
      return { adjustedPrice: bestAskPx, clamped: true };
    }
  }

  return { adjustedPrice: price, clamped: false };
}

describe("clampPriceToBbo", () => {
  describe("BUY side", () => {
    test("should not clamp buy price below bestAsk", () => {
      const result = clampPriceToBbo("buy", "100.0", "100.0", "100.5");
      expect(result.clamped).toBe(false);
      expect(result.adjustedPrice).toBe("100.0");
    });

    test("should clamp buy price equal to bestAsk down to bestBid", () => {
      const result = clampPriceToBbo("buy", "100.5", "100.0", "100.5");
      expect(result.clamped).toBe(true);
      expect(result.adjustedPrice).toBe("100.0");
    });

    test("should clamp buy price above bestAsk down to bestBid", () => {
      const result = clampPriceToBbo("buy", "101.0", "100.0", "100.5");
      expect(result.clamped).toBe(true);
      expect(result.adjustedPrice).toBe("100.0");
    });

    test("should not clamp buy price just below bestAsk", () => {
      const result = clampPriceToBbo("buy", "100.49", "100.0", "100.5");
      expect(result.clamped).toBe(false);
      expect(result.adjustedPrice).toBe("100.49");
    });
  });

  describe("SELL side", () => {
    test("should not clamp sell price above bestBid", () => {
      const result = clampPriceToBbo("sell", "100.5", "100.0", "100.5");
      expect(result.clamped).toBe(false);
      expect(result.adjustedPrice).toBe("100.5");
    });

    test("should clamp sell price equal to bestBid up to bestAsk", () => {
      const result = clampPriceToBbo("sell", "100.0", "100.0", "100.5");
      expect(result.clamped).toBe(true);
      expect(result.adjustedPrice).toBe("100.5");
    });

    test("should clamp sell price below bestBid up to bestAsk", () => {
      const result = clampPriceToBbo("sell", "99.5", "100.0", "100.5");
      expect(result.clamped).toBe(true);
      expect(result.adjustedPrice).toBe("100.5");
    });

    test("should not clamp sell price just above bestBid", () => {
      const result = clampPriceToBbo("sell", "100.01", "100.0", "100.5");
      expect(result.clamped).toBe(false);
      expect(result.adjustedPrice).toBe("100.01");
    });
  });

  describe("edge cases", () => {
    test("should return original price if bestBid is invalid (0)", () => {
      const result = clampPriceToBbo("buy", "100.0", "0", "100.5");
      expect(result.clamped).toBe(false);
      expect(result.adjustedPrice).toBe("100.0");
    });

    test("should return original price if bestAsk is invalid (0)", () => {
      const result = clampPriceToBbo("sell", "100.0", "100.0", "0");
      expect(result.clamped).toBe(false);
      expect(result.adjustedPrice).toBe("100.0");
    });

    test("should return original price if BBO values are NaN", () => {
      const result = clampPriceToBbo("buy", "100.0", "NaN", "100.5");
      expect(result.clamped).toBe(false);
      expect(result.adjustedPrice).toBe("100.0");
    });

    test("should return original price if bestBid is negative", () => {
      const result = clampPriceToBbo("buy", "100.0", "-1", "100.5");
      expect(result.clamped).toBe(false);
      expect(result.adjustedPrice).toBe("100.0");
    });

    test("should handle price exactly between bid and ask (no clamp)", () => {
      // Price at mid-spread should not trigger clamping
      const result = clampPriceToBbo("buy", "100.25", "100.0", "100.5");
      expect(result.clamped).toBe(false);
      expect(result.adjustedPrice).toBe("100.25");
    });
  });

  describe("real-world scenarios", () => {
    test("should prevent post-only rejection for aggressive BUY", () => {
      // Scenario: BBO is 100.0/100.1, strategy calculates bid at 100.15 due to lag
      // Without clamping: order rejected as it would take liquidity
      // With clamping: order placed at 100.0 (bestBid)
      const result = clampPriceToBbo("buy", "100.15", "100.0", "100.1");
      expect(result.clamped).toBe(true);
      expect(result.adjustedPrice).toBe("100.0");
    });

    test("should prevent post-only rejection for aggressive SELL", () => {
      // Scenario: BBO is 100.0/100.1, strategy calculates ask at 99.95 due to lag
      // Without clamping: order rejected as it would take liquidity
      // With clamping: order placed at 100.1 (bestAsk)
      const result = clampPriceToBbo("sell", "99.95", "100.0", "100.1");
      expect(result.clamped).toBe(true);
      expect(result.adjustedPrice).toBe("100.1");
    });

    test("should handle tight spread market (1 tick)", () => {
      // BBO: 100.00/100.01 (1 tick spread)
      // BUY at 100.00 -> no clamp needed
      const buyResult = clampPriceToBbo("buy", "100.00", "100.00", "100.01");
      expect(buyResult.clamped).toBe(false);

      // SELL at 100.01 -> no clamp needed
      const sellResult = clampPriceToBbo("sell", "100.01", "100.00", "100.01");
      expect(sellResult.clamped).toBe(false);
    });

    test("should handle wide spread market", () => {
      // BBO: 95.00/105.00 (wide spread)
      // BUY at 98.00 (within spread) -> no clamp
      const buyResult = clampPriceToBbo("buy", "98.00", "95.00", "105.00");
      expect(buyResult.clamped).toBe(false);
      expect(buyResult.adjustedPrice).toBe("98.00");

      // SELL at 102.00 (within spread) -> no clamp
      const sellResult = clampPriceToBbo("sell", "102.00", "95.00", "105.00");
      expect(sellResult.clamped).toBe(false);
      expect(sellResult.adjustedPrice).toBe("102.00");
    });
  });
});
