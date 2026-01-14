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

  test("sanitizes newline characters to keep one-frame-line = one terminal line", () => {
    const writes: string[] = [];
    const r = new TTYRenderer(s => writes.push(s));

    r.render(["hello\nworld"]);

    const out = writes.join("");
    // Newlines must never be emitted, otherwise the cursor moves and boxes can mix.
    expect(out).not.toContain("\n");
    expect(out).not.toContain("\r");
  });

  test("clamps output to current terminal columns to avoid auto-wrap corrupting box boundaries", () => {
    const writes: string[] = [];
    const r = new TTYRenderer(s => writes.push(s));

    const originalColumns = Object.getOwnPropertyDescriptor(process.stdout, "columns");
    Object.defineProperty(process.stdout, "columns", { value: 10, configurable: true });
    try {
      r.render(["0123456789ABCDEFGHIJ"]);
    } finally {
      if (originalColumns) {
        Object.defineProperty(process.stdout, "columns", originalColumns);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete (process.stdout as unknown as { columns?: unknown }).columns;
      }
    }

    const out = writes.join("");
    // When clamped, we expect an ellipsis added by truncation.
    expect(out).toContain("…");
  });
});
