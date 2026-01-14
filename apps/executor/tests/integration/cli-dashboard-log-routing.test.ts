import { describe, expect, test } from "bun:test";

import { logger } from "@agentic-mm-bot/utils";

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

describe("CLI dashboard log routing (integration)", () => {
  test("when dashboard is enabled, logger.info is captured into the dashboard frame (no console.info)", () => {
    withPatchedStdout(writes =>
      withPatchedIntervals(() => {
        const originalInfo = console.info;
        console.info = (() => {
          throw new Error("console.info should not be called while dashboard sink is active");
        }) as typeof console.info;

        try {
          const dash = new ExecutorCliDashboard({ enabled: true, exchange: "extended", symbol: "BTC-USD" });
          dash.start();

          logger.info("hello-from-logger");

          // Force a render to include log pane content.
          // @ts-expect-error - private method access for unit test
          dash.render();

          const out = writes.join("");
          expect(out).toContain("Logs");
          expect(out).toContain("hello-from-logger");
        } finally {
          logger.clearSink();
          console.info = originalInfo;
        }
      }),
    );
  });
});
