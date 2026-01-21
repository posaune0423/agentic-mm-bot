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
   * Timestamp when position last changed from zero (used by core for unwind timing).
   * - Set when transitioning 0 -> non-zero
   * - Cleared when transitioning non-zero -> 0
   */
  private positionSinceMs?: number;

  /**
   * Update from fill event
   *
   * Note: After a fill, entryPrice and unrealizedPnl become stale
   * (would need recalculation or fresh REST sync). We clear them
   * to avoid displaying outdated/incorrect values.
   */
  updateFromFill(event: FillEvent): void {
    const prevSize = Number.parseFloat(this.size);
    const fillSize = Number.parseFloat(event.size);
    const signedFill = event.side === "buy" ? fillSize : -fillSize;

    const nextSizeNum = prevSize + signedFill;
    this.size = nextSizeNum.toString();
    this.lastUpdateMs = event.ts.getTime();

    // Track positionSinceMs for unwind timing (core expects this).
    // Start timer when entering a position from flat.
    if (prevSize === 0 && nextSizeNum !== 0) {
      this.positionSinceMs = event.ts.getTime();
    }
    // Clear timer when flat again.
    if (nextSizeNum === 0) {
      this.positionSinceMs = undefined;
    }

    // Clear stale values - only size is accurate after fill
    this.entryPrice = undefined;
    this.unrealizedPnl = undefined;
  }

  /**
   * Sync from REST API response
   */
  syncFromPosition(info: PositionInfo | null): void {
    const prevSize = Number.parseFloat(this.size);
    if (info) {
      this.size = info.size;
      this.entryPrice = info.entryPrice;
      this.unrealizedPnl = info.unrealizedPnl;
      this.lastUpdateMs = info.updatedAt.getTime();

      const nextSize = Number.parseFloat(info.size);
      // Best-effort: when we observe 0->non-zero from REST, use the observed updatedAt as positionSinceMs.
      if (prevSize === 0 && nextSize !== 0) {
        this.positionSinceMs = info.updatedAt.getTime();
      }
      if (nextSize === 0) {
        this.positionSinceMs = undefined;
      }
    } else {
      this.size = "0";
      this.entryPrice = undefined;
      this.unrealizedPnl = undefined;
      this.positionSinceMs = undefined;
    }
  }

  /**
   * Get current position for strategy
   */
  getPosition(): Position {
    return {
      size: this.size,
      positionSinceMs: this.positionSinceMs,
    };
  }

  /**
   * Get position size as number
   */
  getPositionSize(): number {
    return Number.parseFloat(this.size);
  }

  /**
   * Get last update time
   */
  getLastUpdateMs(): number {
    return this.lastUpdateMs;
  }

  /**
   * Timestamp when position last changed from zero (for unwind timing / UI)
   */
  getPositionSinceMs(): number | undefined {
    return this.positionSinceMs;
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
