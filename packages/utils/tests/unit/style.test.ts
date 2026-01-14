import { describe, expect, test } from "bun:test";

import { Style } from "../../src/cli-dashboard/style";

describe("Style", () => {
  test("disables ANSI tokens when noColor is true", () => {
    const s = new Style({ noColor: true });
    expect(s.enabled()).toBe(false);
    expect(s.token("red")).toBe("");
    expect(s.token("reset")).toBe("");
  });
});
