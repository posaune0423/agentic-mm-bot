/**
 * Minimal websocket smoke test for `extended-typescript-sdk`.
 *
 * What it checks:
 * - Can create Stream client
 * - Can connect to public WS streams (orderbook + public trades)
 * - Can receive a few messages and print them
 *
 * Usage:
 * - bun scripts/test-extended-ws.ts
 * - bun scripts/test-extended-ws.ts --market BTC-USD --streams trades,orderbook --max 3 --timeout-ms 30000
 *
 * Optional env:
 * - EXTENDED_ENV=testnet|mainnet (default: testnet)
 * - EXTENDED_STREAM_URL=<override ws url>
 * - EXTENDED_INIT_WASM=1 (also calls initWasm(); default: 0)
 */

import { MAINNET_CONFIG, PerpetualStreamClient, TESTNET_CONFIG, initWasm } from "extended-typescript-sdk";

interface Opts {
  env: "testnet" | "mainnet";
  marketName: string;
  streams: string;
  maxMessages: number;
  timeoutMs: number;
  initWasm: boolean;
}

function usage(): string {
  return [
    "extended-typescript-sdk WS smoke test",
    "",
    "Usage:",
    "  bun scripts/test-extended-ws.ts [--market BTC-USD] [--streams trades|orderbook|trades,orderbook] [--max 10] [--timeout-ms 30000] [--env testnet|mainnet] [--init-wasm]",
    "",
    "Env:",
    "  EXTENDED_ENV=testnet|mainnet",
    "  EXTENDED_STREAM_URL=<override>",
    "  EXTENDED_INIT_WASM=1",
    "",
  ].join("\n");
}

function parseArgs(argv: string[]): Partial<Opts> & { help?: boolean } {
  const out: Partial<Opts> & { help?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--market") out.marketName = argv[++i] ?? "";
    else if (a === "--streams") out.streams = argv[++i] ?? "";
    else if (a === "--max") out.maxMessages = Number(argv[++i]);
    else if (a === "--timeout-ms") out.timeoutMs = Number(argv[++i]);
    else if (a === "--env") out.env = (argv[++i] ?? "testnet") as Opts["env"];
    else if (a === "--init-wasm") out.initWasm = true;
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

function summarizeMsg(msg: unknown): unknown {
  if (!msg || typeof msg !== "object") return msg;
  const m = msg as Record<string, unknown>;
  const data = m.data;
  if (Array.isArray(data) && data.length > 5) {
    return {
      ...m,
      data: data.slice(0, 5),
      dataTruncated: true,
      dataLen: data.length,
    };
  }
  return msg;
}

async function maybeConnect(stream: unknown): Promise<void> {
  const s = stream as { connect?: () => Promise<void> };
  if (typeof s.connect === "function") {
    await s.connect();
  }
}

async function consume<T>(
  label: string,
  stream: AsyncIterable<T>,
  maxMessages: number,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  let count = 0;

  for await (const msg of stream) {
    count++;
    console.log(JSON.stringify({ ts: nowIso(), stream: label, n: count, msg: summarizeMsg(msg) }, null, 2));

    if (count >= maxMessages) break;
    if (Date.now() - startedAt >= timeoutMs) break;
  }
}

function normalizeStreams(s: string): Array<"trades" | "orderbook"> {
  const raw = s
    .split(",")
    .map(x => x.trim().toLowerCase())
    .filter(Boolean);
  const set = new Set(raw);
  const out: Array<"trades" | "orderbook"> = [];
  if (set.has("trades")) out.push("trades");
  if (set.has("orderbook")) out.push("orderbook");
  return out.length ? out : ["trades"];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  const env = (process.env.EXTENDED_ENV as Opts["env"] | undefined) ?? args.env ?? "testnet";
  const marketName = args.marketName ?? "BTC-USD";
  const streams = normalizeStreams(args.streams ?? "trades");
  const maxMessages = asInt(args.maxMessages ?? undefined, 10);
  const timeoutMs = asInt(args.timeoutMs ?? undefined, 30_000);
  const doInitWasm = process.env.EXTENDED_INIT_WASM === "1" || args.initWasm === true;

  console.log(
    JSON.stringify(
      {
        ts: nowIso(),
        action: "start",
        env,
        marketName,
        streams,
        maxMessages,
        timeoutMs,
        initWasm: doInitWasm,
      },
      null,
      2,
    ),
  );

  process.once("SIGINT", () => process.exit(130));
  process.once("SIGTERM", () => process.exit(143));

  if (doInitWasm) {
    console.log(`[${nowIso()}] initWasm()...`);
    await initWasm();
    console.log(`[${nowIso()}] initWasm() ok`);
  }

  const cfg = env === "mainnet" ? MAINNET_CONFIG : TESTNET_CONFIG;
  const apiUrl = process.env.EXTENDED_STREAM_URL ?? cfg.streamUrl;

  console.log(`[${nowIso()}] stream apiUrl=${apiUrl}`);

  const streamClient = new PerpetualStreamClient({ apiUrl });

  const orderbookStream =
    streams.includes("orderbook") ? streamClient.subscribeToOrderbooks({ marketName, depth: 10 }) : null;
  const tradesStream = streams.includes("trades") ? streamClient.subscribeToPublicTrades(marketName) : null;

  await Promise.all([
    orderbookStream ? maybeConnect(orderbookStream) : undefined,
    tradesStream ? maybeConnect(tradesStream) : undefined,
  ]);

  console.log(`[${nowIso()}] connected; consuming messages...`);

  await Promise.race([
    Promise.all([
      orderbookStream ?
        consume("orderbook", orderbookStream as unknown as AsyncIterable<unknown>, maxMessages, timeoutMs)
      : undefined,
      tradesStream ?
        consume("trades", tradesStream as unknown as AsyncIterable<unknown>, maxMessages, timeoutMs)
      : undefined,
    ]),
    new Promise<void>(resolve => setTimeout(resolve, timeoutMs + 5_000)),
  ]);

  console.log(`[${nowIso()}] done`);
  // Some stream implementations keep sockets/timers alive; this is a smoke test, so exit hard.
  process.exit(0);
}

await main();
