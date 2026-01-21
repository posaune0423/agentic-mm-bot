/**
 * BBO Clamping Unit Tests
 *
 * Tests for the price clamping logic that prevents post-only rejections
 * while allowing the strategy to quote inside the spread.
 *
 * BUFFER-BASED APPROACH:
 * - A small safety buffer (1 bps) is used to account for latency and market movement
 * - BUY: clamp if price >= (bestAsk - buffer)
 * - SELL: clamp if price <= (bestBid + buffer)
 *
 * This allows quoting inside the spread for better fills while avoiding
 * post-only rejections from crossing the spread.
 */

import { describe, expect, test } from "bun:test";

/**
 * Safety buffer in basis points (mirrors decision-cycle.ts)
 */
const POST_ONLY_SAFETY_BUFFER_BPS = 1;

/**
 * Clamp price to avoid crossing the BBO with a safety buffer.
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

  const mid = (bestBid + bestAsk) / 2;
  const bufferPrice = (mid * POST_ONLY_SAFETY_BUFFER_BPS) / 10_000;

  if (side === "buy") {
    // BUY at or below bestBid is always safe
    if (priceNum <= bestBid) {
      return { adjustedPrice: price, clamped: false };
    }
    // BUY inside spread: clamp if too close to bestAsk
    const threshold = bestAsk - bufferPrice;
    if (priceNum >= threshold) {
      return { adjustedPrice: bestBidPx, clamped: true };
    }
  } else {
    // SELL at or above bestAsk is always safe
    if (priceNum >= bestAsk) {
      return { adjustedPrice: price, clamped: false };
    }
    // SELL inside spread: clamp if too close to bestBid
    const threshold = bestBid + bufferPrice;
    if (priceNum <= threshold) {
      return { adjustedPrice: bestAskPx, clamped: true };
    }
  }

  return { adjustedPrice: price, clamped: false };
}

describe("clampPriceToBbo", () => {
  describe("BUY side - buffer-based clamping", () => {
    test("should not clamp buy price well inside spread", () => {
      // BBO: 100.0/101.0 (100 bps spread), mid=100.5
      // Buffer = 100.5 * 1 / 10000 = 0.01005
      // Threshold = 101.0 - 0.01005 = 100.98995
      // Price 100.25 is well below threshold -> no clamp
      const result = clampPriceToBbo("buy", "100.25", "100.0", "101.0");
      expect(result.clamped).toBe(false);
      expect(result.adjustedPrice).toBe("100.25");
    });

    test("should not clamp buy price at bestBid", () => {
      const result = clampPriceToBbo("buy", "100.0", "100.0", "101.0");
      expect(result.clamped).toBe(false);
      expect(result.adjustedPrice).toBe("100.0");
    });

    test("should not clamp buy price below bestBid", () => {
      const result = clampPriceToBbo("buy", "99.5", "100.0", "101.0");
      expect(result.clamped).toBe(false);
      expect(result.adjustedPrice).toBe("99.5");
    });

    test("should clamp buy price at bestAsk down to bestBid", () => {
      const result = clampPriceToBbo("buy", "101.0", "100.0", "101.0");
      expect(result.clamped).toBe(true);
      expect(result.adjustedPrice).toBe("100.0");
    });

    test("should clamp buy price above bestAsk down to bestBid", () => {
      const result = clampPriceToBbo("buy", "102.0", "100.0", "101.0");
      expect(result.clamped).toBe(true);
      expect(result.adjustedPrice).toBe("100.0");
    });

    test("should clamp buy price very close to bestAsk (within buffer)", () => {
      // BBO: 100.0/101.0, mid=100.5
      // Buffer = 0.01005, threshold = 100.98995
      // Price 100.99 is >= threshold -> clamp
      const result = clampPriceToBbo("buy", "100.99", "100.0", "101.0");
      expect(result.clamped).toBe(true);
      expect(result.adjustedPrice).toBe("100.0");
    });
  });

  describe("SELL side - buffer-based clamping", () => {
    test("should not clamp sell price well inside spread", () => {
      // BBO: 100.0/101.0 (100 bps spread), mid=100.5
      // Buffer = 0.01005
      // Threshold = 100.0 + 0.01005 = 100.01005
      // Price 100.75 is well above threshold -> no clamp
      const result = clampPriceToBbo("sell", "100.75", "100.0", "101.0");
      expect(result.clamped).toBe(false);
      expect(result.adjustedPrice).toBe("100.75");
    });

    test("should not clamp sell price at bestAsk", () => {
      const result = clampPriceToBbo("sell", "101.0", "100.0", "101.0");
      expect(result.clamped).toBe(false);
      expect(result.adjustedPrice).toBe("101.0");
    });

    test("should not clamp sell price above bestAsk", () => {
      const result = clampPriceToBbo("sell", "102.0", "100.0", "101.0");
      expect(result.clamped).toBe(false);
      expect(result.adjustedPrice).toBe("102.0");
    });

    test("should clamp sell price at bestBid up to bestAsk", () => {
      const result = clampPriceToBbo("sell", "100.0", "100.0", "101.0");
      expect(result.clamped).toBe(true);
      expect(result.adjustedPrice).toBe("101.0");
    });

    test("should clamp sell price below bestBid up to bestAsk", () => {
      const result = clampPriceToBbo("sell", "99.0", "100.0", "101.0");
      expect(result.clamped).toBe(true);
      expect(result.adjustedPrice).toBe("101.0");
    });

    test("should clamp sell price very close to bestBid (within buffer)", () => {
      // BBO: 100.0/101.0, mid=100.5
      // Buffer = 0.01005, threshold = 100.01005
      // Price 100.01 is <= threshold -> clamp
      const result = clampPriceToBbo("sell", "100.01", "100.0", "101.0");
      expect(result.clamped).toBe(true);
      expect(result.adjustedPrice).toBe("101.0");
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
  });

  describe("real-world scenarios", () => {
    test("should allow quoting inside wide spread", () => {
      // BBO: 100.0/102.0 (200 bps wide spread), mid=101
      // Buffer = 101 * 1 / 10000 = 0.0101
      // BUY threshold = 102.0 - 0.0101 = 101.9899
      // SELL threshold = 100.0 + 0.0101 = 100.0101

      // BUY at 101.0 (mid) - well inside spread, should NOT clamp
      const buyResult = clampPriceToBbo("buy", "101.0", "100.0", "102.0");
      expect(buyResult.clamped).toBe(false);
      expect(buyResult.adjustedPrice).toBe("101.0");

      // SELL at 101.0 (mid) - well inside spread, should NOT clamp
      const sellResult = clampPriceToBbo("sell", "101.0", "100.0", "102.0");
      expect(sellResult.clamped).toBe(false);
      expect(sellResult.adjustedPrice).toBe("101.0");
    });

    test("should clamp when too close to opposite side", () => {
      // BBO: 100.0/100.1 (10 bps tight spread), mid=100.05
      // Buffer = 100.05 * 1 / 10000 = 0.010005
      // BUY threshold = 100.1 - 0.010005 = 100.089995
      // SELL threshold = 100.0 + 0.010005 = 100.010005

      // BUY at 100.09 >= threshold -> clamp
      const buyResult = clampPriceToBbo("buy", "100.09", "100.0", "100.1");
      expect(buyResult.clamped).toBe(true);
      expect(buyResult.adjustedPrice).toBe("100.0");

      // SELL at 100.01 <= threshold -> clamp
      const sellResult = clampPriceToBbo("sell", "100.01", "100.0", "100.1");
      expect(sellResult.clamped).toBe(true);
      expect(sellResult.adjustedPrice).toBe("100.1");
    });

    test("should handle tight spread market (1 tick)", () => {
      // BBO: 100.00/100.01 (1 tick spread)
      // BUY at 100.00 -> no clamp needed (at bestBid)
      const buyResult = clampPriceToBbo("buy", "100.00", "100.00", "100.01");
      expect(buyResult.clamped).toBe(false);

      // SELL at 100.01 -> no clamp needed (at bestAsk)
      const sellResult = clampPriceToBbo("sell", "100.01", "100.00", "100.01");
      expect(sellResult.clamped).toBe(false);
    });

    test("should allow prices outside the spread (passive)", () => {
      // BBO: 100.00/101.00
      // BUY at 99.90 (below bestBid) -> no clamp, very passive
      const buyResult = clampPriceToBbo("buy", "99.90", "100.00", "101.00");
      expect(buyResult.clamped).toBe(false);
      expect(buyResult.adjustedPrice).toBe("99.90");

      // SELL at 101.50 (above bestAsk) -> no clamp, very passive
      const sellResult = clampPriceToBbo("sell", "101.50", "100.00", "101.00");
      expect(sellResult.clamped).toBe(false);
      expect(sellResult.adjustedPrice).toBe("101.50");
    });
  });
});
