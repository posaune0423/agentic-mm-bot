/**
 * Position Tracker - In-memory tracking of current position
 *
 * Requirements: 4.6, 4.7, 4.8
 * - Track position from private stream or REST
 */

import type { Position, PriceStr, SizeStr } from "@agentic-mm-bot/core";
import type { FillEvent, PositionInfo } from "@agentic-mm-bot/adapters";

/**
 * Position Tracker
 *
 * Tracks current position in memory.
 */
export class PositionTracker {
  private size: SizeStr = "0";
  private entryPrice?: PriceStr;
  private unrealizedPnl?: PriceStr;
  private lastUpdateMs: number = 0;

  /**
   * Update from fill event
   */
  updateFromFill(event: FillEvent): void {
    const currentSize = parseFloat(this.size);
    const fillSize = parseFloat(event.size);
    const signedFill = event.side === "buy" ? fillSize : -fillSize;

    this.size = (currentSize + signedFill).toString();
    this.lastUpdateMs = event.ts.getTime();
  }

  /**
   * Sync from REST API response
   */
  syncFromPosition(info: PositionInfo | null): void {
    if (info) {
      this.size = info.size;
      this.entryPrice = info.entryPrice;
      this.unrealizedPnl = info.unrealizedPnl;
      this.lastUpdateMs = info.updatedAt.getTime();
    } else {
      this.size = "0";
      this.entryPrice = undefined;
      this.unrealizedPnl = undefined;
    }
  }

  /**
   * Get current position for strategy
   */
  getPosition(): Position {
    return {
      size: this.size,
    };
  }

  /**
   * Get position size as number
   */
  getPositionSize(): number {
    return parseFloat(this.size);
  }

  /**
   * Get last update time
   */
  getLastUpdateMs(): number {
    return this.lastUpdateMs;
  }

  /**
   * Debug/observability helpers (for CLI UI)
   */
  getEntryPrice(): PriceStr | undefined {
    return this.entryPrice;
  }

  getUnrealizedPnl(): PriceStr | undefined {
    return this.unrealizedPnl;
  }
}
