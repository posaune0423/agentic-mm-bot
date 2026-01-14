import { describe, expect, test } from "bun:test";

import { TTYScreen } from "../../src/cli-dashboard/tty-screen";

describe("TTYScreen", () => {
  test("start/stop writes alternate-screen sequences (idempotent)", () => {
    const writes: string[] = [];
    const screen = new TTYScreen({
      enabled: true,
      write: s => writes.push(s),
      onProcessOnce: (_event, _handler) => {
        // no-op for unit test (avoid registering global handlers)
      },
    });

    screen.start();
    screen.start();
    expect(writes.join("")).toContain("\x1b[?1049h");
    expect(writes.join("")).toContain("\x1b[?25l");

    screen.stop();
    screen.stop();
    expect(writes.join("")).toContain("\x1b[?25h");
    expect(writes.join("")).toContain("\x1b[?1049l");
  });
});
