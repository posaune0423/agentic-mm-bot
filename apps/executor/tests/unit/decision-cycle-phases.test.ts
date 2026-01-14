import { describe, expect, test } from "bun:test";
import { okAsync } from "neverthrow";

import type { ExecutionPort } from "@agentic-mm-bot/adapters";
import { createInitialState, type StrategyParams } from "@agentic-mm-bot/core";

import { executeTick } from "../../src/usecases/decision-cycle";

describe("executeTick phase hooks", () => {
  test("emits phases in the expected order", async () => {
    const phases: string[] = [];

    const executionPort: ExecutionPort = {
      placeOrder: req =>
        okAsync({
          clientOrderId: req.clientOrderId,
          exchangeOrderId: "ex-1",
          status: "open",
          ts: new Date(),
        }),
      cancelOrder: req =>
        okAsync({
          clientOrderId: req.clientOrderId ?? "cid",
          exchangeOrderId: req.exchangeOrderId,
          status: "cancelled",
          ts: new Date(),
        }),
      cancelAllOrders: () => okAsync(undefined),
      getOpenOrders: () => okAsync([]),
      getPosition: () => okAsync(null),
      onEvent: () => {},
      connectPrivateStream: () => okAsync(undefined),
      disconnectPrivateStream: () => okAsync(undefined),
    };

    const params: StrategyParams = {
      baseHalfSpreadBps: "10",
      volSpreadGain: "1",
      toxSpreadGain: "1",
      quoteSizeUsd: "10",
      refreshIntervalMs: 1000,
      staleCancelMs: 5000,
      maxInventory: "1",
      inventorySkewGain: "5",
      pauseMarkIndexBps: "50",
      pauseLiqCount10s: 3,
    };

    const nowMs = Date.now();
    const deps = {
      marketDataCache: {
        getSnapshot: (t: number) => ({
          exchange: "extended",
          symbol: "BTC-USD",
          nowMs: t,
          bestBidPx: "100",
          bestBidSz: "1",
          bestAskPx: "101",
          bestAskSz: "1",
          lastUpdateMs: t - 10,
        }),
        getTradesInWindow: () => [],
        getMidSnapshotsInWindow: () => [],
      },
      orderTracker: {
        getBidOrder: () => null,
        getAskOrder: () => null,
        getActiveOrders: () => [],
        addOrder: () => {},
        clear: () => {},
        syncFromOpenOrders: () => {},
      },
      positionTracker: { getPosition: () => ({ size: "0" }) },
      executionPort,
      params,
      onPhase: (p: string) => phases.push(p),
    };

    await executeTick(deps as never, createInitialState(nowMs));

    // Minimum guarantee: we should at least see a read/decide/execution style sequence.
    expect(phases[0]).toBe("READ");
    expect(phases).toContain("DECIDE");
    expect(phases).toContain("EXECUTE");
  });
});
