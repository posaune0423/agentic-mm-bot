import { describe, expect, test } from "bun:test";

import { TTYRenderer } from "../../src/cli-dashboard/tty-renderer";

describe("TTYRenderer", () => {
  test("does not write anything when rendering the same frame twice", () => {
    const writes: string[] = [];
    const r = new TTYRenderer(s => writes.push(s));

    const frame = ["a", "b", "c"] as const;
    r.render(frame);
    const writesAfterFirst = writes.length;

    r.render(frame);
    expect(writes.length).toBe(writesAfterFirst);
  });

  test("clears removed lines when frame shrinks", () => {
    const writes: string[] = [];
    const r = new TTYRenderer(s => writes.push(s));

    r.render(["line1", "line2", "line3"]);
    r.render(["line1"]);

    const out = writes.join("");
    // Erase-in-line (2K) should be emitted for at least one removed line.
    expect(out).toContain("\x1b[2K");
  });
});
