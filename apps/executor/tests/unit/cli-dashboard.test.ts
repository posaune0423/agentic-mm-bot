import { describe, expect, test } from "bun:test";

import { withPatchedIntervals, withPatchedStdout } from "@agentic-mm-bot/utils";

import { ExecutorCliDashboard } from "../../src/services/cli-dashboard";
import type { TickDebug } from "../../src/services/cli-dashboard";

// Helper to create a minimal tick for testing
function createMockTick(overrides: Partial<TickDebug> = {}): TickDebug {
  const nowMs = Date.now();
  return {
    nowMs,
    snapshot: {
      exchange: "extended",
      symbol: "BTC-USD",
      bestBidPx: "100000.00",
      bestBidSz: "1.0",
      bestAskPx: "100001.00",
      bestAskSz: "1.0",
      markPx: "100000.50",
      indexPx: "100000.50",
      lastUpdateMs: nowMs - 1000,
    },
    features: {
      realizedVol10s: "0.05",
      tradeImbalance1s: "0.1",
      markIndexDivBps: "0.5",
      liqCount10s: 0,
    },
    output: {
      mode: "NORMAL",
      reasonCodes: [],
      intents: [],
    },
    stateBefore: {
      mode: "NORMAL",
      modeSinceMs: nowMs - 60_000,
      lastQuoteMs: nowMs - 1000,
    },
    stateAfter: {
      mode: "NORMAL",
      modeSinceMs: nowMs - 60_000,
      lastQuoteMs: nowMs - 1000,
    },
    paramsSetId: "test-params-id",
    dbParams: {
      baseHalfSpreadBps: "10",
      volSpreadGain: "1",
      toxSpreadGain: "1",
      quoteSizeUsd: "50",
      refreshIntervalMs: 1000,
      staleCancelMs: 5000,
      maxInventory: "1",
      inventorySkewGain: "5",
      pauseMarkIndexBps: "50",
      pauseLiqCount10s: 3,
    },
    effectiveParams: {
      baseHalfSpreadBps: "10",
      volSpreadGain: "1",
      toxSpreadGain: "1",
      quoteSizeUsd: "50",
      refreshIntervalMs: 1000,
      staleCancelMs: 5000,
      maxInventory: "1",
      inventorySkewGain: "5",
      pauseMarkIndexBps: "50",
      pauseLiqCount10s: 3,
    },
    overlayState: {
      active: false,
      tightenBps: 0,
      lastFillMs: null,
      lastTightenMs: null,
    },
    plannedActions: [],
    targetQuote: undefined,
    orders: [],
    position: {
      size: "0.5",
      entryPrice: "99500.00",
      unrealizedPnl: "250.00",
      lastUpdateMs: nowMs - 5000, // 5 seconds ago (fresh)
    },
    funding: undefined,
    ...overrides,
  };
}

describe("ExecutorCliDashboard", () => {
  test("start/stop writes alternate-screen sequences when enabled", () => {
    withPatchedStdout(writes =>
      withPatchedIntervals(() => {
        const dash = new ExecutorCliDashboard({
          enabled: true,
          exchange: "extended",
          symbol: "BTC-USD",
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

  test("render outputs a stable frame even without tick data", () => {
    withPatchedStdout(writes =>
      withPatchedIntervals(() => {
        const dash = new ExecutorCliDashboard({
          enabled: true,
          exchange: "extended",
          symbol: "BTC-USD",
        });

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

  test("position section displays Age field", () => {
    withPatchedStdout(writes =>
      withPatchedIntervals(() => {
        const dash = new ExecutorCliDashboard({
          enabled: true,
          exchange: "extended",
          symbol: "BTC-USD",
        });

        // Set tick with recent position data
        const tick = createMockTick();
        dash.setTick(tick);

        // @ts-expect-error - private method access for unit test
        dash.render();

        const out = writes.join("");
        expect(out).toContain("Position / Inventory");
        expect(out).toContain("Age:");
        // Position is fresh (5s old), so no STALE badge
        expect(out).not.toContain("STALE");
      }),
    );
  });

  test("position section shows STALE warning badge when position is 60s+ old", () => {
    withPatchedStdout(writes =>
      withPatchedIntervals(() => {
        const dash = new ExecutorCliDashboard({
          enabled: true,
          exchange: "extended",
          symbol: "BTC-USD",
        });

        const nowMs = Date.now();
        // Position is 90 seconds old (warning threshold is 60s)
        const tick = createMockTick({
          position: {
            size: "0.5",
            entryPrice: "99500.00",
            unrealizedPnl: "250.00",
            lastUpdateMs: nowMs - 90_000,
          },
        });
        dash.setTick(tick);

        // @ts-expect-error - private method access for unit test
        dash.render();

        const out = writes.join("");
        expect(out).toContain("Position / Inventory");
        expect(out).toContain("Age:");
        // Should show STALE badge (yellow warning)
        expect(out).toContain("STALE");
      }),
    );
  });

  test("position section shows STALE error badge when position is 120s+ old", () => {
    withPatchedStdout(writes =>
      withPatchedIntervals(() => {
        const dash = new ExecutorCliDashboard({
          enabled: true,
          exchange: "extended",
          symbol: "BTC-USD",
        });

        const nowMs = Date.now();
        // Position is 150 seconds old (error threshold is 120s)
        const tick = createMockTick({
          position: {
            size: "0.5",
            entryPrice: "99500.00",
            unrealizedPnl: "250.00",
            lastUpdateMs: nowMs - 150_000,
          },
        });
        dash.setTick(tick);

        // @ts-expect-error - private method access for unit test
        dash.render();

        const out = writes.join("");
        expect(out).toContain("Position / Inventory");
        expect(out).toContain("Age:");
        // Should show STALE badge (red error)
        expect(out).toContain("STALE");
      }),
    );
  });

  test("setPosition updates realtime position for immediate UI refresh", () => {
    withPatchedStdout(writes =>
      withPatchedIntervals(() => {
        const dash = new ExecutorCliDashboard({
          enabled: true,
          exchange: "extended",
          symbol: "BTC-USD",
        });

        // Set tick with old position
        const nowMs = Date.now();
        const tick = createMockTick({
          position: {
            size: "0.5",
            entryPrice: "99500.00",
            unrealizedPnl: "250.00",
            lastUpdateMs: nowMs - 100_000, // old position in tick
          },
        });
        dash.setTick(tick);

        // Update realtime position (simulating fill event)
        dash.setPosition({
          size: "0.6",
          entryPrice: undefined, // cleared after fill
          unrealizedPnl: undefined,
          lastUpdateMs: nowMs, // fresh
        });

        // @ts-expect-error - private method access for unit test
        dash.render();

        const out = writes.join("");
        // Should show updated size from realtime position
        expect(out).toContain("0.6");
        // Realtime position is fresh, so no STALE badge
        expect(out).not.toContain("STALE");
      }),
    );
  });
});
