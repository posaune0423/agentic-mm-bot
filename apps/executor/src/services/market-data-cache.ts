/**
 * Market Data Cache - In-memory cache for hot path
 *
 * Requirements: 4.1, 4.6, 6.1-6.5
 * - Latest BBO/mark/index
 * - Recent trades for feature calculation
 * - No DB dependency for hot path
 */

import type { Ms, PriceStr, Snapshot, SizeStr } from "@agentic-mm-bot/core";
import type { MidSnapshot, TradeData } from "@agentic-mm-bot/core";
import type {
  BboEvent,
  PriceEvent,
  TradeEvent,
} from "@agentic-mm-bot/adapters";

const TRADES_WINDOW_MS = 10_000; // 10 seconds
const MID_SNAPSHOTS_WINDOW_MS = 10_000; // 10 seconds

/**
 * Market Data Cache
 *
 * Holds latest market data and recent history for feature calculation.
 */
export class MarketDataCache {
  private exchange: string;
  private symbol: string;

  private bestBidPx: PriceStr = "0";
  private bestBidSz: SizeStr = "0";
  private bestAskPx: PriceStr = "0";
  private bestAskSz: SizeStr = "0";
  private markPx?: PriceStr;
  private indexPx?: PriceStr;
  private lastUpdateMs: Ms = 0;

  private trades: TradeData[] = [];
  private midSnapshots: MidSnapshot[] = [];

  constructor(exchange: string, symbol: string) {
    this.exchange = exchange;
    this.symbol = symbol;
  }

  /**
   * Update from BBO event
   */
  updateBbo(event: BboEvent): void {
    this.bestBidPx = event.bestBidPx;
    this.bestBidSz = event.bestBidSz;
    this.bestAskPx = event.bestAskPx;
    this.bestAskSz = event.bestAskSz;
    this.lastUpdateMs = event.ts.getTime();

    // Add mid snapshot for volatility calculation
    const mid = (parseFloat(event.bestBidPx) + parseFloat(event.bestAskPx)) / 2;
    this.midSnapshots.push({
      ts: event.ts.getTime(),
      midPx: mid.toString(),
    });

    this.pruneOldData(event.ts.getTime());
  }

  /**
   * Update from price event (mark/index)
   */
  updatePrice(event: PriceEvent): void {
    if (event.markPx) this.markPx = event.markPx;
    if (event.indexPx) this.indexPx = event.indexPx;
    this.lastUpdateMs = Math.max(this.lastUpdateMs, event.ts.getTime());
  }

  /**
   * Add trade event
   */
  addTrade(event: TradeEvent): void {
    this.trades.push({
      ts: event.ts.getTime(),
      px: event.px,
      sz: event.sz,
      side: event.side,
      type: event.tradeType,
    });

    this.pruneOldData(event.ts.getTime());
  }

  /**
   * Get current snapshot for decision making
   */
  getSnapshot(nowMs: Ms): Snapshot {
    return {
      exchange: this.exchange,
      symbol: this.symbol,
      nowMs,
      bestBidPx: this.bestBidPx,
      bestBidSz: this.bestBidSz,
      bestAskPx: this.bestAskPx,
      bestAskSz: this.bestAskSz,
      markPx: this.markPx,
      indexPx: this.indexPx,
      lastUpdateMs: this.lastUpdateMs,
    };
  }

  /**
   * Get trades in last N milliseconds
   */
  getTradesInWindow(nowMs: Ms, windowMs: Ms): TradeData[] {
    const cutoff = nowMs - windowMs;
    return this.trades.filter((t) => t.ts >= cutoff);
  }

  /**
   * Get mid snapshots in last N milliseconds
   */
  getMidSnapshotsInWindow(nowMs: Ms, windowMs: Ms): MidSnapshot[] {
    const cutoff = nowMs - windowMs;
    return this.midSnapshots.filter((s) => s.ts >= cutoff);
  }

  /**
   * Check if we have valid data
   */
  hasValidData(): boolean {
    return (
      this.lastUpdateMs > 0 &&
      parseFloat(this.bestBidPx) > 0 &&
      parseFloat(this.bestAskPx) > 0
    );
  }

  /**
   * Prune old data to prevent memory growth
   */
  private pruneOldData(nowMs: Ms): void {
    const tradeCutoff = nowMs - TRADES_WINDOW_MS;
    const midCutoff = nowMs - MID_SNAPSHOTS_WINDOW_MS;

    this.trades = this.trades.filter((t) => t.ts >= tradeCutoff);
    this.midSnapshots = this.midSnapshots.filter((s) => s.ts >= midCutoff);
  }
}
