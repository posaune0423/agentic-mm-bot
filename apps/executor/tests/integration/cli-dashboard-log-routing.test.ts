import { describe, expect, test } from "bun:test";

import { logger, withPatchedIntervals, withPatchedStdout } from "@agentic-mm-bot/utils";

import { ExecutorCliDashboard } from "../../src/services/cli-dashboard";

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
          expect(out).toContain("LOGS");
          expect(out).toContain("hello-from-logger");
        } finally {
          logger.clearSink();
          console.info = originalInfo;
        }
      }),
    );
  });
});
