/**
 * ExtendedMarketDataAdapter WS smoke test (manual).
 *
 * This tests the adapter (not just the SDK) by subscribing to multiple channels and
 * printing the first few normalized domain events.
 *
 * Usage:
 *   cd packages/adapters
 *   bun run ws:adapter-test --market BTC-USD --channels bbo,trades,prices,funding --max 5 --timeout-ms 20000
 */

import { ExtendedMarketDataAdapter } from "../src/extended/market-data-adapter";
import type { MarketDataEvent, MarketDataSubscription } from "../src/ports";

interface Opts {
  market: string;
  channels: Array<"bbo" | "trades" | "prices" | "funding">;
  maxPerType: number;
  timeoutMs: number;
}

function parseArgs(argv: string[]): Partial<Opts> & { help?: boolean } {
  const out: Partial<Opts> & { help?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--market") out.market = argv[++i] ?? "";
    else if (a === "--channels") {
      const raw = (argv[++i] ?? "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
      out.channels = raw as Opts["channels"];
    } else if (a === "--max") out.maxPerType = Number(argv[++i]);
    else if (a === "--timeout-ms") out.timeoutMs = Number(argv[++i]);
  }
  return out;
}

function asInt(v: unknown, fallback: number): number {
  const n =
    typeof v === "number" ? v
    : typeof v === "string" ? Number(v)
    : Number.NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function nowIso(): string {
  return new Date().toISOString();
}

function summarize(event: MarketDataEvent): unknown {
  if (event.type === "bbo") {
    return {
      type: event.type,
      exchange: event.exchange,
      symbol: event.symbol,
      ts: event.ts.toISOString(),
      bestBidPx: event.bestBidPx,
      bestAskPx: event.bestAskPx,
      seq: event.seq,
    };
  }
  if (event.type === "trade") {
    return {
      type: event.type,
      exchange: event.exchange,
      symbol: event.symbol,
      ts: event.ts.toISOString(),
      px: event.px,
      sz: event.sz,
      side: event.side,
      tradeType: event.tradeType,
      seq: event.seq,
    };
  }
  if (event.type === "price") {
    return {
      type: event.type,
      priceType: event.priceType,
      exchange: event.exchange,
      symbol: event.symbol,
      ts: event.ts.toISOString(),
      markPx: event.markPx,
      indexPx: event.indexPx,
      seq: event.seq,
    };
  }
  if (event.type === "funding") {
    return {
      type: event.type,
      exchange: event.exchange,
      symbol: event.symbol,
      ts: event.ts.toISOString(),
      fundingRate: event.fundingRate,
      seq: event.seq,
    };
  }
  return {
    type: event.type,
    exchange: event.exchange,
    ts: event.ts.toISOString(),
    reason: event.reason,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: bun run ws:adapter-test --market BTC-USD --channels bbo,trades,prices,funding --max 2 --timeout-ms 20000",
    );
    process.exit(0);
  }

  const opts: Opts = {
    market: args.market ?? "BTC-USD",
    channels: args.channels ?? ["bbo", "trades"],
    maxPerType: asInt(args.maxPerType ?? undefined, 2),
    timeoutMs: asInt(args.timeoutMs ?? undefined, 20_000),
  };

  const adapter = new ExtendedMarketDataAdapter({
    // NOTE: public market-data streams don't require auth; dummy values are ok for this smoke test.
    network: "testnet",
    vaultId: 0,
    starkPrivateKey: "0x1",
    starkPublicKey: "0x1",
    apiKey: "dummy",
  });

  const events: MarketDataEvent[] = [];
  const seen: Record<MarketDataEvent["type"], number> = {
    bbo: 0,
    trade: 0,
    price: 0,
    funding: 0,
    connected: 0,
    disconnected: 0,
    reconnecting: 0,
  };
  adapter.onEvent(e => {
    events.push(e);
    seen[e.type]++;
    // Print only first N per type (avoid huge logs when a message contains many trades)
    const n = seen[e.type];
    if (n <= opts.maxPerType) {
      console.log(JSON.stringify({ ts: nowIso(), event: summarize(e) }, null, 2));
    }
  });

  const sub: MarketDataSubscription = {
    exchange: "extended",
    symbol: opts.market,
    channels: opts.channels,
  };
  const subRes = adapter.subscribe(sub);
  if (subRes.isErr()) {
    console.error(subRes.error);
    process.exit(1);
  }

  const connRes = await adapter.connect();
  if (connRes.isErr()) {
    console.error(connRes.error);
    process.exit(1);
  }

  const deadline = Date.now() + opts.timeoutMs;
  // Require at least one trade and one bbo; optionally wait for others if requested.
  while (Date.now() < deadline) {
    const gotBbo = seen.bbo > 0;
    const gotTrade = seen.trade > 0;

    const wantsPrices = opts.channels.includes("prices");
    const wantsFunding = opts.channels.includes("funding");
    const gotPrice = seen.price > 0;
    const gotFunding = seen.funding > 0;

    const ok =
      gotBbo &&
      gotTrade &&
      (!wantsPrices || gotPrice || Date.now() + 2_000 > deadline) &&
      (!wantsFunding || gotFunding || Date.now() + 2_000 > deadline);

    if (ok) break;
    await new Promise(r => setTimeout(r, 50));
  }

  const gotBbo = seen.bbo > 0;
  const gotTrade = seen.trade > 0;
  const gotPrice = seen.price > 0;
  const gotFunding = seen.funding > 0;

  console.log(
    JSON.stringify(
      {
        ts: nowIso(),
        summary: {
          total: events.length,
          counts: seen,
          gotBbo,
          gotTrade,
          gotPrice,
          gotFunding,
        },
      },
      null,
      2,
    ),
  );

  await adapter.disconnect();

  // Ensure this process ends even if underlying sockets linger.
  process.exit(gotBbo && gotTrade ? 0 : 2);
}

await main();
