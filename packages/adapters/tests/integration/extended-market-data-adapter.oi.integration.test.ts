import { expect, test } from "bun:test";

import { ExtendedMarketDataAdapter } from "../../src/extended/market-data-adapter";
import type { MarketDataEvent, OpenInterestEvent } from "../../src/ports";

function waitFor<T>(fn: () => T | undefined, timeoutMs: number): Promise<T> {
  const started = Date.now();
  return new Promise<T>((resolve, reject) => {
    const tick = () => {
      const v = fn();
      if (v !== undefined) return resolve(v);
      if (Date.now() - started >= timeoutMs) return reject(new Error(`timeout after ${timeoutMs}ms`));
      setTimeout(tick, 25);
    };
    tick();
  });
}

test("ExtendedMarketDataAdapter emits OI via SDK marketInfo client (no fetch)", async () => {
  // If implementation accidentally falls back to fetch, fail fast.
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = () => {
    throw new Error("fetch should not be called for OI (must use SDK)");
  };

  try {
    let calls = 0;
    let lastArgs: { marketNames: string[] } | undefined;

    const stubMarketInfoClient = {
      getMarkets: async (args: { marketNames: string[] }) => {
        calls++;
        lastArgs = args;
        // Mimic SDK response shape: { data: [MarketModel] }
        return {
          data: [
            {
              market: args.marketNames[0],
              openInterest: "123.45",
              openInterestUsd: "67890.12",
            },
          ],
        };
      },
    };

    const adapter = new ExtendedMarketDataAdapter(
      {
        network: "testnet",
        // Values are unused by this test since we inject marketInfoClient.
        vaultId: 0,
        starkPrivateKey: "0x1",
        starkPublicKey: "0x1",
        apiKey: "dummy",
      },
      { initialDelayMs: 10, maxDelayMs: 10, multiplier: 1 },
      undefined,
      stubMarketInfoClient,
    );

    const events: MarketDataEvent[] = [];
    adapter.onEvent(e => events.push(e));

    const subRes = adapter.subscribe({
      exchange: "extended",
      symbol: "BTC-USD",
      channels: ["oi"],
    });
    expect(subRes.isOk()).toBeTrue();

    const connRes = await adapter.connect();
    expect(connRes.isOk()).toBeTrue();

    try {
      const oi = await waitFor(() => events.find(e => e.type === "oi") as OpenInterestEvent | undefined, 1_500);
      expect(calls).toBeGreaterThan(0);
      expect(lastArgs).toEqual({ marketNames: ["BTC-USD"] });
      expect(oi.exchange).toBe("extended");
      expect(oi.symbol).toBe("BTC-USD");
      expect(oi.openInterest).toBe("123.45");
      expect(oi.openInterestUsd).toBe("67890.12");
    } finally {
      await adapter.disconnect();
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
