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
    return this.decide(nowMs, currentMid).shouldWrite;
  }

  /**
   * Decide whether to write and why (for observability / UI).
   * Side-effect: when shouldWrite=true, it updates internal lastWriteMs/lastMid (same as shouldWrite()).
   */
  decide(
    nowMs: number,
    currentMid: number,
  ): {
    shouldWrite: boolean;
    reason: "first_write" | "time_throttle" | "price_change" | "throttled";
    throttleMs: number;
    minChangeBps: number;
    timeSinceLastWriteMs: number;
    lastMid: number | null;
    currentMid: number;
    changeBps: number | null;
  } {
    const timeSinceLastWriteMs = nowMs - this.lastWriteMs;
    const timePassed = timeSinceLastWriteMs >= this.throttleMs;

    const isFirstWrite = this.lastMid === null;

    let changeBps: number | null = null;
    let priceChanged = false;
    if (this.lastMid !== null && this.lastMid > 0) {
      changeBps = Math.abs((currentMid - this.lastMid) / this.lastMid) * 10000;
      priceChanged = changeBps >= this.minChangeBps;
    }

    const shouldWrite = isFirstWrite || timePassed || priceChanged;
    const reason: "first_write" | "time_throttle" | "price_change" | "throttled" =
      isFirstWrite ? "first_write"
      : timePassed ? "time_throttle"
      : priceChanged ? "price_change"
      : "throttled";

    if (shouldWrite) {
      this.lastWriteMs = nowMs;
      this.lastMid = currentMid;
    }

    return {
      shouldWrite,
      reason,
      throttleMs: this.throttleMs,
      minChangeBps: this.minChangeBps,
      timeSinceLastWriteMs,
      lastMid: this.lastMid,
      currentMid,
      changeBps,
    };
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
