import { describe, expect, test } from "bun:test";

import { ExecutorCliDashboard } from "../../src/services/cli-dashboard";

function withPatchedStdout<T>(fn: (writes: string[]) => T): T {
  const writes: string[] = [];

  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  process.stdout.write = ((chunk: unknown) => {
    writes.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    return fn(writes);
  } finally {
    process.stdout.write = originalWrite;
    if (originalIsTTY) {
      Object.defineProperty(process.stdout, "isTTY", originalIsTTY);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (process.stdout as unknown as { isTTY?: unknown }).isTTY;
    }
  }
}

function withPatchedIntervals<T>(fn: () => T): T {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;

  // Prevent background rendering in tests.
  globalThis.setInterval = ((handler: TimerHandler, timeout?: number) => {
    void handler;
    void timeout;
    return 1 as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;

  globalThis.clearInterval = ((id: ReturnType<typeof setInterval>) => {
    void id;
  }) as typeof clearInterval;

  try {
    return fn();
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
}

describe("ExecutorCliDashboard", () => {
  test("start/stop writes alternate-screen sequences when enabled", () => {
    withPatchedStdout(writes =>
      withPatchedIntervals(() => {
        const dash = new ExecutorCliDashboard({ enabled: true, exchange: "extended", symbol: "BTC-USD" });

        dash.start();
        expect(writes.length).toBeGreaterThan(0);
        expect(writes[0]).toContain("\x1b[?1049h"); // altScreenOn
        expect(writes[0]).toContain("\x1b[?25l"); // hideCursor

        dash.stop();
        expect(writes[writes.length - 1]).toContain("\x1b[?25h"); // showCursor
        expect(writes[writes.length - 1]).toContain("\x1b[?1049l"); // altScreenOff
      }),
    );
  });

  test("render outputs a stable frame even without tick data", () => {
    withPatchedStdout(writes =>
      withPatchedIntervals(() => {
        const dash = new ExecutorCliDashboard({ enabled: true, exchange: "extended", symbol: "BTC-USD" });

        // Access private render for test verification.
        // @ts-expect-error - private method access for unit test
        dash.render();

        const out = writes.join("");
        // New boxed dashboard format (rich TTY UI)
        expect(out).toContain("EXECUTOR DASHBOARD");
        expect(out).toContain("MARKET");
        expect(out).toContain("STRATEGY");
        expect(out).toContain("ORDERS");
        expect(out).toContain("LOGS");
        expect(out).toContain("No market data");
        expect(out).toContain("No strategy data");
        expect(out).toContain("No order data");
      }),
    );
  });
});
