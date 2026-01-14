import { describe, expect, test } from "bun:test";

import { IngestorCliDashboard } from "../../src/services/cli-dashboard";

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

describe("IngestorCliDashboard", () => {
  test("start/stop writes alternate-screen sequences when enabled", () => {
    withPatchedStdout(writes =>
      withPatchedIntervals(() => {
        const dash = new IngestorCliDashboard({
          enabled: true,
          exchange: "extended",
          symbol: "BTC-USD",
          initialMetrics: {
            bboReceived: 0,
            bboWritten: 0,
            tradeReceived: 0,
            priceReceived: 0,
            fundingReceived: 0,
            bboBufferSize: 0,
            tradeBufferSize: 0,
            priceBufferSize: 0,
          },
        });

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

  test("render outputs a stable frame even without events", () => {
    withPatchedStdout(writes =>
      withPatchedIntervals(() => {
        const dash = new IngestorCliDashboard({
          enabled: true,
          exchange: "extended",
          symbol: "BTC-USD",
          initialMetrics: {
            bboReceived: 0,
            bboWritten: 0,
            tradeReceived: 0,
            priceReceived: 0,
            fundingReceived: 0,
            bboBufferSize: 0,
            tradeBufferSize: 0,
            priceBufferSize: 0,
          },
        });

        // @ts-expect-error - private method access for unit test
        dash.render();

        const out = writes.join("");
        // New boxed format uses uppercase title and structured sections
        expect(out).toContain("INGESTOR DASHBOARD");
        expect(out).toContain("MARKET DATA");
        expect(out).toContain("BBO: No data");
        expect(out).toContain("Trade: No data");
        expect(out).toContain("Price: No data");
        expect(out).toContain("METRICS");
        expect(out).toContain("BUFFERS");
        expect(out).toContain("LOGS");
      }),
    );
  });
});
