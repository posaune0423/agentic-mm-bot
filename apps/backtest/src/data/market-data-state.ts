/**
 * Market Data State - In-memory state for backtest
 *
 * Requirements: 11.1, 6.1-6.5
 * - Track latest BBO/mark/index
 * - Maintain rolling windows for trades and mid snapshots
 * - Provide Snapshot and feature calculation inputs
 */

import type { Ms, PriceStr, Snapshot, SizeStr } from "@agentic-mm-bot/core";
import type { MidSnapshot, TradeData } from "@agentic-mm-bot/core";
import type { MdBbo, MdPrice, MdTrade } from "@agentic-mm-bot/db";

const TRADES_WINDOW_MS = 10_000; // 10 seconds
const MID_SNAPSHOTS_WINDOW_MS = 10_000; // 10 seconds

/**
 * Market Data State for backtest
 *
 * Tracks market data state at a specific point in simulated time.
 */
export class MarketDataState {
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
   * Update from BBO record
   */
  updateBbo(bbo: MdBbo): void {
    this.bestBidPx = bbo.bestBidPx;
    this.bestBidSz = bbo.bestBidSz;
    this.bestAskPx = bbo.bestAskPx;
    this.bestAskSz = bbo.bestAskSz;
    this.lastUpdateMs = bbo.ts.getTime();

    // Add mid snapshot for volatility calculation
    this.midSnapshots.push({
      ts: bbo.ts.getTime(),
      midPx: bbo.midPx,
    });
  }

  /**
   * Update from price record (mark/index)
   */
  updatePrice(price: MdPrice): void {
    if (price.markPx) this.markPx = price.markPx;
    if (price.indexPx) this.indexPx = price.indexPx;
    this.lastUpdateMs = Math.max(this.lastUpdateMs, price.ts.getTime());
  }

  /**
   * Add trade record
   */
  addTrade(trade: MdTrade): void {
    this.trades.push({
      ts: trade.ts.getTime(),
      px: trade.px,
      sz: trade.sz,
      side: trade.side as "buy" | "sell" | undefined,
      type: trade.type as "normal" | "liq" | "delev" | undefined,
    });
  }

  /**
   * Prune old data based on current tick time
   */
  pruneOldData(nowMs: Ms): void {
    const tradeCutoff = nowMs - TRADES_WINDOW_MS;
    const midCutoff = nowMs - MID_SNAPSHOTS_WINDOW_MS;

    this.trades = this.trades.filter(t => t.ts >= tradeCutoff);
    this.midSnapshots = this.midSnapshots.filter(s => s.ts >= midCutoff);
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
    return this.trades.filter(t => t.ts >= cutoff);
  }

  /**
   * Get mid snapshots in last N milliseconds
   */
  getMidSnapshotsInWindow(nowMs: Ms, windowMs: Ms): MidSnapshot[] {
    const cutoff = nowMs - windowMs;
    return this.midSnapshots.filter(s => s.ts >= cutoff);
  }

  /**
   * Check if we have valid data
   */
  hasValidData(): boolean {
    return this.lastUpdateMs > 0 && parseFloat(this.bestBidPx) > 0 && parseFloat(this.bestAskPx) > 0;
  }

  /**
   * Get all trades (for touch fill checking)
   */
  getAllTrades(): TradeData[] {
    return this.trades;
  }

  /**
   * Get last update time
   */
  getLastUpdateMs(): Ms {
    return this.lastUpdateMs;
  }

  /**
   * Get current mid price
   */
  getMidPx(): PriceStr {
    const bid = parseFloat(this.bestBidPx);
    const ask = parseFloat(this.bestAskPx);
    return ((bid + ask) / 2).toFixed(8);
  }
}
