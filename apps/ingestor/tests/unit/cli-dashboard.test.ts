import { describe, expect, test } from "bun:test";

import { withPatchedIntervals, withPatchedStdout } from "@agentic-mm-bot/utils";

import { IngestorCliDashboard } from "../../src/services/cli-dashboard";

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
