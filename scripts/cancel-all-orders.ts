/**
 * Cancel All Orders Script
 *
 * Cancels all open orders for a specified symbol on Extended exchange.
 *
 * Usage:
 *   bun run scripts/cancel-all-orders.ts --symbol BTC-USD
 *   bun run scripts/cancel-all-orders.ts --symbol BTC-USD --init-wasm
 *
 * Environment variables (same as executor):
 *   EXTENDED_NETWORK=testnet|mainnet (default: testnet)
 *   EXTENDED_API_KEY=<your api key>
 *   EXTENDED_STARK_PRIVATE_KEY=<hex>
 *   EXTENDED_STARK_PUBLIC_KEY=<hex>
 *   EXTENDED_VAULT_ID=<number>
 *   SYMBOL=<symbol> (fallback if --symbol not provided)
 */

import { config } from "dotenv";
import { resolve } from "path";

// Load .env from project root
config({ path: resolve(process.cwd(), ".env") });

import { ExtendedExecutionAdapter, ExtendedConfigSchema, initWasm } from "@agentic-mm-bot/adapters";

// ============================================================================
// CLI Parsing
// ============================================================================

interface Opts {
  symbol: string | null;
  initWasm: boolean;
  help: boolean;
}

function usage(): string {
  return `
Cancel All Orders - Extended Exchange

Usage:
  bun run scripts/cancel-all-orders.ts --symbol <SYMBOL> [--init-wasm]

Options:
  --symbol <SYMBOL>   Market symbol (e.g. BTC-USD). Required (or set SYMBOL env).
  --init-wasm         Explicitly initialize WASM (usually auto-detected).
  --help, -h          Show this help message.

Environment variables:
  EXTENDED_NETWORK            testnet|mainnet (default: testnet)
  EXTENDED_API_KEY            API key from Extended Exchange
  EXTENDED_STARK_PRIVATE_KEY  Stark private key (hex)
  EXTENDED_STARK_PUBLIC_KEY   Stark public key (hex)
  EXTENDED_VAULT_ID           Vault ID
  SYMBOL                      Fallback symbol if --symbol not provided

Example:
  EXTENDED_NETWORK=testnet EXTENDED_API_KEY=... EXTENDED_STARK_PRIVATE_KEY=... \\
    EXTENDED_STARK_PUBLIC_KEY=... EXTENDED_VAULT_ID=... \\
    bun run scripts/cancel-all-orders.ts --symbol BTC-USD
`.trim();
}

function parseArgs(argv: string[]): Opts {
  const opts: Opts = {
    symbol: null,
    initWasm: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--symbol") {
      opts.symbol = argv[++i] ?? null;
    } else if (arg === "--init-wasm") {
      opts.initWasm = true;
    }
  }

  return opts;
}

function nowIso(): string {
  return new Date().toISOString();
}

function log(msg: string, data?: Record<string, unknown>): void {
  if (data) {
    console.log(`[${nowIso()}] ${msg}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`[${nowIso()}] ${msg}`);
  }
}

function logError(msg: string, error?: unknown): void {
  console.error(`[${nowIso()}] ERROR: ${msg}`, error instanceof Error ? error.message : error);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  // Resolve symbol
  const symbol = args.symbol ?? process.env.SYMBOL;
  if (!symbol) {
    console.error("ERROR: --symbol is required (or set SYMBOL env).\n");
    console.log(usage());
    process.exit(1);
  }

  // Validate Extended config from env
  const configResult = ExtendedConfigSchema.safeParse({
    network: process.env.EXTENDED_NETWORK ?? "testnet",
    apiKey: process.env.EXTENDED_API_KEY,
    starkPrivateKey: process.env.EXTENDED_STARK_PRIVATE_KEY,
    starkPublicKey: process.env.EXTENDED_STARK_PUBLIC_KEY,
    vaultId: process.env.EXTENDED_VAULT_ID,
  });

  if (!configResult.success) {
    console.error("ERROR: Invalid Extended config from environment.");
    console.error(configResult.error.format());
    process.exit(1);
  }

  const extendedConfig = configResult.data;

  log("Starting cancel-all-orders", {
    symbol,
    network: extendedConfig.network,
    vaultId: extendedConfig.vaultId,
  });

  // Initialize WASM if requested
  if (args.initWasm) {
    log("Initializing WASM...");
    try {
      await initWasm();
      log("WASM initialized");
    } catch (error) {
      logError("Failed to initialize WASM", error);
      process.exit(1);
    }
  }

  // Create execution adapter
  const executionAdapter = new ExtendedExecutionAdapter(extendedConfig);

  // Step 1: Get current open orders
  log(`Fetching open orders for ${symbol}...`);
  const openOrdersResult = await executionAdapter.getOpenOrders(symbol);

  if (openOrdersResult.isErr()) {
    logError("Failed to fetch open orders", openOrdersResult.error);
    process.exit(1);
  }

  const openOrders = openOrdersResult.value;
  log(`Found ${openOrders.length} open order(s)`, {
    buys: openOrders.filter(o => o.side === "buy").length,
    sells: openOrders.filter(o => o.side === "sell").length,
  });

  if (openOrders.length === 0) {
    log("No open orders to cancel. Done.");
    process.exit(0);
  }

  // Step 2: Cancel all orders
  log(`Cancelling all orders for ${symbol}...`);
  const cancelResult = await executionAdapter.cancelAllOrders(symbol);

  if (cancelResult.isErr()) {
    logError("Failed to cancel orders", cancelResult.error);
    process.exit(1);
  }

  log("Cancel request sent successfully");

  // Step 3: Verify cancellation (wait a bit for exchange to process)
  log("Waiting 2s for exchange to process cancellations...");
  await new Promise(resolve => setTimeout(resolve, 2000));

  log("Verifying cancellation...");
  const verifyResult = await executionAdapter.getOpenOrders(symbol);

  if (verifyResult.isErr()) {
    logError("Failed to verify cancellation", verifyResult.error);
    process.exit(1);
  }

  const remainingOrders = verifyResult.value;

  if (remainingOrders.length === 0) {
    log("✓ All orders cancelled successfully. Remaining: 0");
    process.exit(0);
  } else {
    log(`✗ ${remainingOrders.length} order(s) still open after cancel`, {
      remaining: remainingOrders.map(o => ({
        id: o.exchangeOrderId,
        side: o.side,
        price: o.price,
        size: o.size,
      })),
    });
    process.exit(1);
  }
}

// Run
main().catch(error => {
  logError("Unexpected error", error);
  process.exit(1);
});
