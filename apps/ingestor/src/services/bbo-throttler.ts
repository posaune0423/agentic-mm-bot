/**
 * BBO Throttler Service
 *
 * Requirements: 3.6
 * - Limits BBO write frequency with time-based and price-change-based throttling
 * - Either condition being met triggers a write
 */

/**
 * BBO Throttler - Limits BBO write frequency
 *
 * Throttling conditions (OR logic):
 * - Time passed >= throttleMs (minimum interval between writes)
 * - Mid price changed >= minChangeBps (minimum price movement to trigger write)
 */
export class BboThrottler {
  private lastWriteMs: number = 0;
  private lastMid: number | null = null;
  private readonly throttleMs: number;
  private readonly minChangeBps: number;

  constructor(throttleMs: number, minChangeBps: number) {
    this.throttleMs = throttleMs;
    this.minChangeBps = minChangeBps;
  }

  /**
   * Check if a write should be performed based on throttling conditions
   *
   * @param nowMs - Current timestamp in milliseconds
   * @param currentMid - Current mid price
   * @returns true if write should be performed
   */
  shouldWrite(nowMs: number, currentMid: number): boolean {
    // Time-based throttling
    const timePassed = nowMs - this.lastWriteMs >= this.throttleMs;

    // Price-change-based throttling
    let priceChanged = false;
    if (this.lastMid !== null && this.lastMid > 0) {
      const changeBps = Math.abs((currentMid - this.lastMid) / this.lastMid) * 10000;
      priceChanged = changeBps >= this.minChangeBps;
    }

    // First write always passes
    const isFirstWrite = this.lastMid === null;

    if (isFirstWrite || timePassed || priceChanged) {
      this.lastWriteMs = nowMs;
      this.lastMid = currentMid;
      return true;
    }

    return false;
  }

  /**
   * Get last write timestamp (for testing)
   */
  getLastWriteMs(): number {
    return this.lastWriteMs;
  }

  /**
   * Get last mid price (for testing)
   */
  getLastMid(): number | null {
    return this.lastMid;
  }

  /**
   * Reset throttler state
   */
  reset(): void {
    this.lastWriteMs = 0;
    this.lastMid = null;
  }
}
