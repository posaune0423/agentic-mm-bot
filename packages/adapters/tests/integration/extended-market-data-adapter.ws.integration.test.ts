import { expect, test } from "bun:test";

import { ExtendedMarketDataAdapter } from "../../src/extended/market-data-adapter";
import type { BboEvent, MarketDataEvent, PriceEvent, TradeEvent } from "../../src/ports";

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

const it = process.env.EXTENDED_WS_INTEGRATION === "1" ? test : test.skip;

it("ExtendedMarketDataAdapter can receive WS trade + bbo + price events (mainnet)", async () => {
  // Uses direct `ws` package via WsConnection - no globalThis.WebSocket hack needed.
  const adapter = new ExtendedMarketDataAdapter({
    // Public market-data streams don't require auth; dummy values are ok for tests.
    // NOTE: orderbooks are not reliably emitted on testnet; mainnet is stable for this integration check.
    network: "mainnet",
    vaultId: 0,
    starkPrivateKey: "0x1",
    starkPublicKey: "0x1",
    apiKey: "dummy",
  });

  const events: MarketDataEvent[] = [];
  adapter.onEvent(e => events.push(e));

  const subRes = adapter.subscribe({
    exchange: "extended",
    symbol: "BTC-USD",
    channels: ["trades", "bbo", "prices"],
  });
  expect(subRes.isOk()).toBeTrue();

  const connRes = await adapter.connect();
  expect(connRes.isOk()).toBeTrue();

  try {
    const trade = await waitFor(() => events.find(e => e.type === "trade") as TradeEvent | undefined, 8_000);
    expect(trade.exchange).toBe("extended");
    expect(trade.symbol).toBe("BTC-USD");
    expect(trade.px).toBeTruthy();
    expect(trade.sz).toBeTruthy();

    const bbo = await waitFor(() => events.find(e => e.type === "bbo") as BboEvent | undefined, 8_000);
    expect(bbo.exchange).toBe("extended");
    expect(bbo.symbol).toBe("BTC-USD");
    expect(bbo.bestBidPx).toBeTruthy();
    expect(bbo.bestAskPx).toBeTruthy();

    const mark = await waitFor(
      () => events.find(e => e.type === "price" && (e as PriceEvent).priceType === "mark") as PriceEvent | undefined,
      12_000,
    );
    expect(mark.exchange).toBe("extended");
    expect(mark.symbol).toBe("BTC-USD");
    expect(mark.markPx).toBeTruthy();

    const index = await waitFor(
      () => events.find(e => e.type === "price" && (e as PriceEvent).priceType === "index") as PriceEvent | undefined,
      12_000,
    );
    expect(index.exchange).toBe("extended");
    expect(index.symbol).toBe("BTC-USD");
    expect(index.indexPx).toBeTruthy();
  } finally {
    await adapter.disconnect();
  }
}, 35_000);
