/**
 * Proposal Applier Unit Tests
 *
 * Requirements: 10.4, 10.5, 10.6
 */

import { describe, expect, test } from "bun:test";

import { isAtFiveMinuteBoundary, isAtTimeBoundary } from "../../src/services/proposal-applier";

// ─────────────────────────────────────────────────────────────────────────────
// isAtFiveMinuteBoundary Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("isAtFiveMinuteBoundary", () => {
  test("should return true at exactly 00:00", () => {
    // 2024-01-01 00:00:00.000
    const ts = new Date("2024-01-01T00:00:00.000Z").getTime();
    expect(isAtFiveMinuteBoundary(ts)).toBe(true);
  });

  test("should return true at 00:05:00", () => {
    const ts = new Date("2024-01-01T00:05:00.000Z").getTime();
    expect(isAtFiveMinuteBoundary(ts)).toBe(true);
  });

  test("should return true at 00:10:00", () => {
    const ts = new Date("2024-01-01T00:10:00.000Z").getTime();
    expect(isAtFiveMinuteBoundary(ts)).toBe(true);
  });

  test("should return true within first 30 seconds of boundary", () => {
    const ts = new Date("2024-01-01T00:05:29.999Z").getTime();
    expect(isAtFiveMinuteBoundary(ts)).toBe(true);
  });

  test("should return false at 30 seconds past boundary", () => {
    const ts = new Date("2024-01-01T00:05:30.000Z").getTime();
    expect(isAtFiveMinuteBoundary(ts)).toBe(false);
  });

  test("should return false at 00:01:00 (not a 5-min boundary)", () => {
    const ts = new Date("2024-01-01T00:01:00.000Z").getTime();
    expect(isAtFiveMinuteBoundary(ts)).toBe(false);
  });

  test("should return false at 00:03:00 (not a 5-min boundary)", () => {
    const ts = new Date("2024-01-01T00:03:00.000Z").getTime();
    expect(isAtFiveMinuteBoundary(ts)).toBe(false);
  });

  test("should return true at 12:15:00", () => {
    const ts = new Date("2024-01-01T12:15:00.000Z").getTime();
    expect(isAtFiveMinuteBoundary(ts)).toBe(true);
  });

  test("should return true at 23:55:00", () => {
    const ts = new Date("2024-01-01T23:55:00.000Z").getTime();
    expect(isAtFiveMinuteBoundary(ts)).toBe(true);
  });
});

describe("isAtTimeBoundary", () => {
  test("should support 1-minute boundaries", () => {
    const ts = new Date("2024-01-01T00:01:00.000Z").getTime();
    expect(isAtTimeBoundary(ts, { boundaryMinutes: 1, graceSeconds: 30 })).toBe(true);
  });

  test("should return false when outside grace window", () => {
    const ts = new Date("2024-01-01T00:01:30.000Z").getTime();
    expect(isAtTimeBoundary(ts, { boundaryMinutes: 1, graceSeconds: 30 })).toBe(false);
  });
});
