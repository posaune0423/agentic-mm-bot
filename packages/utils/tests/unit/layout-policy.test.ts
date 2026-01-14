import { describe, expect, test } from "bun:test";

import { LayoutPolicy } from "../../src/cli-dashboard/layout-policy";

describe("LayoutPolicy", () => {
  test("padRight keeps stable width", () => {
    const p = new LayoutPolicy();
    expect(p.padRight("a", 4)).toBe("a   ");
    // We don't truncate (renderer clears whole line), only pad based on visible width.
    expect(p.padRight("abcdef", 4)).toBe("abcdef");
  });

  test("formatAgeMs returns '-' for missing ts", () => {
    const p = new LayoutPolicy();
    expect(p.formatAgeMs(1000, undefined)).toBe("-");
  });

  test("formatDurationMs is monotonic friendly and fixed-ish width", () => {
    const p = new LayoutPolicy();
    expect(p.formatDurationMs(0)).toContain("ms");
    expect(p.formatDurationMs(1500)).toContain("s");
  });
});
