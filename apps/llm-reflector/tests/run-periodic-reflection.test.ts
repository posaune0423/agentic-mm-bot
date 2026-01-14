import { describe, expect, test } from "bun:test";

import { createWindowGuard, getLastCompleteWindow } from "../src/usecases/run-hourly-reflection/usecase";

describe("getLastCompleteWindow", () => {
  test("returns the last complete 5-min window when now is inside a window", () => {
    const now = new Date("2024-01-01T00:07:30.000Z");
    const { start, end } = getLastCompleteWindow(now, 5);

    expect(start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2024-01-01T00:05:00.000Z");
  });

  test("returns the immediately previous 5-min window when now is exactly on a boundary", () => {
    const now = new Date("2024-01-01T00:10:00.000Z");
    const { start, end } = getLastCompleteWindow(now, 5);

    expect(start.toISOString()).toBe("2024-01-01T00:05:00.000Z");
    expect(end.toISOString()).toBe("2024-01-01T00:10:00.000Z");
  });

  test("throws when windowMinutes is outside 1-60 or non-integer", () => {
    const now = new Date("2024-01-01T00:07:30.000Z");

    expect(() => getLastCompleteWindow(now, 61)).toThrow(RangeError);
    expect(() => getLastCompleteWindow(now, 61)).toThrow(/getLastCompleteWindow/);
    expect(() => getLastCompleteWindow(now, 61)).toThrow(/windowMinutes/);

    expect(() => getLastCompleteWindow(now, 1.5)).toThrow(RangeError);
  });
});

describe("createWindowGuard", () => {
  test("runs only once per window end timestamp", () => {
    const guard = createWindowGuard();
    const windowEnd = new Date("2024-01-01T00:05:00.000Z");

    expect(guard.shouldRun(windowEnd)).toBe(true);
    guard.markProcessed(windowEnd);

    expect(guard.shouldRun(windowEnd)).toBe(false);
  });

  test("allows running again when the window advances", () => {
    const guard = createWindowGuard();
    const windowEnd1 = new Date("2024-01-01T00:05:00.000Z");
    const windowEnd2 = new Date("2024-01-01T00:10:00.000Z");

    expect(guard.shouldRun(windowEnd1)).toBe(true);
    guard.markProcessed(windowEnd1);

    expect(guard.shouldRun(windowEnd2)).toBe(true);
  });
});
