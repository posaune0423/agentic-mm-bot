/**
 * BBO clamping
 *
 * Post-only orders must not take liquidity. This helper clamps prices near the
 * opposite side with a small safety buffer to reduce POST_ONLY_REJECT spam
 * while still allowing quoting inside the spread.
 */

/**
 * Safety buffer for post-only clamping (in basis points of mid price).
 *
 * A 1 bps buffer on a $100 price = $0.01 safety margin.
 */
const POST_ONLY_SAFETY_BUFFER_BPS = 1;

/**
 * Clamp price to avoid crossing the BBO with a safety buffer.
 *
 * For post-only to succeed, the order must NOT take liquidity:
 * - BUY: price must be strictly BELOW bestAsk
 * - SELL: price must be strictly ABOVE bestBid
 *
 * Safe zones (never clamped):
 * - BUY at or below bestBid → always safe, passive maker
 * - SELL at or above bestAsk → always safe, passive maker
 *
 * Inside the spread, we add a small safety buffer:
 * - BUY: clamp if price > bestBid AND price >= (bestAsk - buffer)
 * - SELL: clamp if price < bestAsk AND price <= (bestBid + buffer)
 */
export function clampPriceToBbo(
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
    // BUY at or below bestBid is always safe (passive maker)
    if (priceNum <= bestBid) {
      return { adjustedPrice: price, clamped: false };
    }
    // BUY inside spread: clamp if too close to bestAsk (within buffer)
    const threshold = bestAsk - bufferPrice;
    if (priceNum >= threshold) {
      return { adjustedPrice: bestBidPx, clamped: true };
    }
  } else {
    // SELL at or above bestAsk is always safe (passive maker)
    if (priceNum >= bestAsk) {
      return { adjustedPrice: price, clamped: false };
    }
    // SELL inside spread: clamp if too close to bestBid (within buffer)
    const threshold = bestBid + bufferPrice;
    if (priceNum <= threshold) {
      return { adjustedPrice: bestAskPx, clamped: true };
    }
  }

  return { adjustedPrice: price, clamped: false };
}
