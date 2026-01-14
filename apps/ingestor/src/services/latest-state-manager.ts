/**
 * Latest State Manager Service
 *
 * Requirements: 3.3
 * - Manages latest market data state in memory
 * - Periodically upserts to latest_top table
 */

import type { Db } from "@agentic-mm-bot/db";
import { latestTop } from "@agentic-mm-bot/db";
import { logger } from "@agentic-mm-bot/utils";
import type { LatestState } from "../types";

/**
 * Latest State Manager - Manages latest_top state and periodic upsert
 */
export class LatestStateManager {
  private readonly db: Db;
  private state: LatestState | null = null;
  private upsertIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(db: Db) {
    this.db = db;
  }

  /**
   * Update BBO state
   */
  updateBbo(
    exchange: string,
    symbol: string,
    ts: Date,
    bestBidPx: string,
    bestBidSz: string,
    bestAskPx: string,
    bestAskSz: string,
    midPx: string,
  ): void {
    const bid = parseFloat(bestBidPx);
    const ask = parseFloat(bestAskPx);
    // Guard: if BBO is crossed/invalid, keep previous prices but still refresh timestamp.
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid >= ask) {
      if (this.state) {
        this.state.ts = ts;
        this.state.dirty = true;
      }
      return;
    }

    if (!this.state) {
      this.state = {
        exchange,
        symbol,
        ts,
        bestBidPx,
        bestBidSz,
        bestAskPx,
        bestAskSz,
        midPx,
        dirty: true,
      };
    } else {
      this.state.ts = ts;
      this.state.bestBidPx = bestBidPx;
      this.state.bestBidSz = bestBidSz;
      this.state.bestAskPx = bestAskPx;
      this.state.bestAskSz = bestAskSz;
      this.state.midPx = midPx;
      this.state.dirty = true;
    }
  }

  /**
   * Update mark price
   */
  updateMarkPrice(markPx: string): void {
    if (this.state) {
      this.state.markPx = markPx;
      this.state.dirty = true;
    }
  }

  /**
   * Update index price
   */
  updateIndexPrice(indexPx: string): void {
    if (this.state) {
      this.state.indexPx = indexPx;
      this.state.dirty = true;
    }
  }

  /**
   * Get current state (for testing/debugging)
   */
  getState(): LatestState | null {
    return this.state;
  }

  /**
   * Upsert current state to latest_top table
   */
  async upsert(): Promise<void> {
    if (!this.state || !this.state.dirty) return;

    try {
      await this.db
        .insert(latestTop)
        .values({
          exchange: this.state.exchange,
          symbol: this.state.symbol,
          ts: this.state.ts,
          bestBidPx: this.state.bestBidPx,
          bestBidSz: this.state.bestBidSz,
          bestAskPx: this.state.bestAskPx,
          bestAskSz: this.state.bestAskSz,
          midPx: this.state.midPx,
          markPx: this.state.markPx,
          indexPx: this.state.indexPx,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [latestTop.exchange, latestTop.symbol],
          set: {
            ts: this.state.ts,
            bestBidPx: this.state.bestBidPx,
            bestBidSz: this.state.bestBidSz,
            bestAskPx: this.state.bestAskPx,
            bestAskSz: this.state.bestAskSz,
            midPx: this.state.midPx,
            markPx: this.state.markPx,
            indexPx: this.state.indexPx,
            updatedAt: new Date(),
          },
        });

      this.state.dirty = false;
      logger.debug("Upserted latest_top");
    } catch (err) {
      logger.error("Failed to upsert latest_top", { error: err });
    }
  }

  /**
   * Start periodic upsert interval
   */
  startUpsertInterval(intervalMs: number): void {
    if (this.upsertIntervalId) {
      clearInterval(this.upsertIntervalId);
    }
    this.upsertIntervalId = setInterval(() => {
      void this.upsert();
    }, intervalMs);
  }

  /**
   * Stop periodic upsert and perform final upsert
   */
  async stop(): Promise<void> {
    if (this.upsertIntervalId) {
      clearInterval(this.upsertIntervalId);
      this.upsertIntervalId = null;
    }
    await this.upsert();
  }
}
