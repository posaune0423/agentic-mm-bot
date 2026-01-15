import { describe, expect, test } from "bun:test";

import { withPatchedIntervals, withPatchedStdout } from "@agentic-mm-bot/utils";

import { ExecutorCliDashboard } from "../../src/services/cli-dashboard";

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
