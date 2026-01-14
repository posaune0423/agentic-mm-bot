import { expect, test } from "bun:test";

import { ExtendedMarketDataAdapter } from "../src/extended/market-data-adapter";

test("ExtendedMarketDataAdapter sequence check ignores duplicate seq within same message (trades)", () => {
  const adapter = new ExtendedMarketDataAdapter({
    network: "testnet",
    vaultId: 0,
    starkPrivateKey: "0x1",
    starkPublicKey: "0x1",
    apiKey: "dummy",
  });

  // Access private method for unit-level regression coverage.
  const checkSequence: (event: { exchange: string; symbol: string; seq?: number }, streamType: string) => unknown =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (adapter as any).checkSequence.bind(adapter);

  const evt = { exchange: "extended", symbol: "BTC-USD", seq: 1 };
  expect(checkSequence(evt, "trades")).toBeNull();
  // Duplicate seq should be ignored (not treated as a gap).
  expect(checkSequence(evt, "trades")).toBeNull();
});
