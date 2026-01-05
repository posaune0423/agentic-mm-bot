/**
 * BBO Throttler Unit Tests
 *
 * Requirements: 3.6
 * - Test time-based throttling (BBO_THROTTLE_MS)
 * - Test price-change-based throttling (BBO_MIN_CHANGE_BPS)
 * - Test that either condition triggers a write
 */

import { describe, expect, test } from "bun:test";

import { BboThrottler } from "../../src/services/bbo-throttler";

describe("BboThrottler", () => {
  describe("first write", () => {
    test("should always allow first write", () => {
      const throttler = new BboThrottler(100, 1);

      const result = throttler.shouldWrite(1000, 50000);

      expect(result).toBe(true);
    });

    test("should update internal state on first write", () => {
      const throttler = new BboThrottler(100, 1);

      throttler.shouldWrite(1000, 50000);

      expect(throttler.getLastWriteMs()).toBe(1000);
      expect(throttler.getLastMid()).toBe(50000);
    });
  });

  describe("time-based throttling", () => {
    test("should block writes within throttle period", () => {
      const throttler = new BboThrottler(100, 1);

      throttler.shouldWrite(1000, 50000); // First write
      const result = throttler.shouldWrite(1050, 50000); // Within throttle period, no price change

      expect(result).toBe(false);
    });

    test("should allow writes after throttle period", () => {
      const throttler = new BboThrottler(100, 1);

      throttler.shouldWrite(1000, 50000); // First write
      const result = throttler.shouldWrite(1100, 50000); // Exactly at throttle boundary

      expect(result).toBe(true);
    });

    test("should allow writes well after throttle period", () => {
      const throttler = new BboThrottler(100, 1);

      throttler.shouldWrite(1000, 50000); // First write
      const result = throttler.shouldWrite(1500, 50000); // Well after throttle period

      expect(result).toBe(true);
    });
  });

  describe("price-change-based throttling", () => {
    test("should allow write on significant price change within throttle period", () => {
      const throttler = new BboThrottler(100, 10); // 10 bps = 0.1%

      throttler.shouldWrite(1000, 50000); // First write
      // 50000 * 0.001 = 50, so 50050 is 10 bps change
      const result = throttler.shouldWrite(1050, 50050); // Within throttle period, but significant change

      expect(result).toBe(true);
    });

    test("should block write on small price change within throttle period", () => {
      const throttler = new BboThrottler(100, 10); // 10 bps = 0.1%

      throttler.shouldWrite(1000, 50000); // First write
      // 50000 * 0.0005 = 25, so 50025 is 5 bps change (below threshold)
      const result = throttler.shouldWrite(1050, 50025); // Within throttle, small change

      expect(result).toBe(false);
    });

    test("should detect price decrease as significant change", () => {
      const throttler = new BboThrottler(100, 10); // 10 bps

      throttler.shouldWrite(1000, 50000); // First write
      // 50000 - 49950 = 50, which is 10 bps downward
      const result = throttler.shouldWrite(1050, 49950); // Price decreased by 10 bps

      expect(result).toBe(true);
    });
  });

  describe("combined conditions", () => {
    test("should allow write when time passed even without price change", () => {
      const throttler = new BboThrottler(100, 10);

      throttler.shouldWrite(1000, 50000);
      const result = throttler.shouldWrite(1200, 50000); // Same price, time passed

      expect(result).toBe(true);
    });

    test("should allow write when price changed even within throttle time", () => {
      const throttler = new BboThrottler(100, 10);

      throttler.shouldWrite(1000, 50000);
      const result = throttler.shouldWrite(1050, 50100); // 20 bps change, within time

      expect(result).toBe(true);
    });

    test("should block when neither condition met", () => {
      const throttler = new BboThrottler(100, 10);

      throttler.shouldWrite(1000, 50000);
      const result = throttler.shouldWrite(1050, 50010); // 2 bps change, within time

      expect(result).toBe(false);
    });
  });

  describe("edge cases", () => {
    test("should handle zero mid price gracefully", () => {
      const throttler = new BboThrottler(100, 10);

      throttler.shouldWrite(1000, 50000);
      // This tests that we don't divide by zero when lastMid > 0
      const result = throttler.shouldWrite(1200, 0);

      expect(result).toBe(true); // Time passed
    });

    test("should handle very small price changes", () => {
      const throttler = new BboThrottler(100, 1); // 1 bps threshold

      throttler.shouldWrite(1000, 50000);
      // 0.01% = 1 bps = 5 price units on 50000
      const result = throttler.shouldWrite(1050, 50005);

      expect(result).toBe(true); // Exactly 1 bps
    });

    test("should handle rapid successive calls", () => {
      const throttler = new BboThrottler(100, 10);

      expect(throttler.shouldWrite(1000, 50000)).toBe(true); // First
      expect(throttler.shouldWrite(1001, 50000)).toBe(false); // 1ms later
      expect(throttler.shouldWrite(1002, 50000)).toBe(false); // 2ms later
      expect(throttler.shouldWrite(1003, 50100)).toBe(true); // 20 bps change
      expect(throttler.shouldWrite(1004, 50100)).toBe(false); // No change
    });

    test("should update lastMid on successful write", () => {
      const throttler = new BboThrottler(100, 10);

      throttler.shouldWrite(1000, 50000);
      throttler.shouldWrite(1050, 50100); // 20 bps change, triggers write

      expect(throttler.getLastMid()).toBe(50100);
    });

    test("should not update lastMid on blocked write", () => {
      const throttler = new BboThrottler(100, 10);

      throttler.shouldWrite(1000, 50000);
      throttler.shouldWrite(1050, 50010); // 2 bps change, blocked

      expect(throttler.getLastMid()).toBe(50000);
    });

    test("should reset state correctly", () => {
      const throttler = new BboThrottler(100, 10);

      throttler.shouldWrite(1000, 50000);
      throttler.reset();

      expect(throttler.getLastWriteMs()).toBe(0);
      expect(throttler.getLastMid()).toBeNull();

      // After reset, next write should be allowed as first write
      expect(throttler.shouldWrite(500, 40000)).toBe(true);
    });
  });
});
