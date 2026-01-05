/**
 * Backtest Main Entry Point
 *
 * Requirements: 11.1-11.4
 * - Replay md_* data
 * - Use same core strategy logic
 * - Simulated execution (touch fill)
 * - Output metrics
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, and, gte, lte, asc } from "drizzle-orm";
import { mdBbo, mdTrade } from "@agentic-mm-bot/db";
import {
  createInitialState,
  decide,
  computeFeatures,
  type StrategyParams,
  type StrategyState,
  type Position,
  type DecideInput,
  type MidSnapshot,
  type TradeData,
  type Snapshot,
} from "@agentic-mm-bot/core";
import { configureLogger, logger } from "@agentic-mm-bot/utils";

import { loadEnv, type Env } from "./env";

/**
 * Simulated order
 */
interface SimulatedOrder {
  side: "buy" | "sell";
  price: number;
  size: number;
  createdAtMs: number;
}

/**
 * Simulated fill
 */
interface SimulatedFill {
  ts: Date;
  side: "buy" | "sell";
  price: number;
  size: number;
  markout10s?: number;
}

/**
 * Backtest results
 */
interface BacktestResults {
  totalFills: number;
  totalCancels: number;
  pauseCount: number;
  fills: SimulatedFill[];
  avgMarkout10sBps?: number;
}

async function main(): Promise<void> {
  const env: Env = loadEnv();

  configureLogger({ logLevel: env.LOG_LEVEL });
  logger.info("Starting backtest", {
    symbol: env.SYMBOL,
    startTime: env.START_TIME,
    endTime: env.END_TIME,
  });

  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const db = drizzle(pool);

  // Load BBO data
  const bboData = await db
    .select()
    .from(mdBbo)
    .where(
      and(
        eq(mdBbo.exchange, env.EXCHANGE),
        eq(mdBbo.symbol, env.SYMBOL),
        gte(mdBbo.ts, env.START_TIME),
        lte(mdBbo.ts, env.END_TIME),
      ),
    )
    .orderBy(asc(mdBbo.ts));

  // Load trade data
  const tradeData = await db
    .select()
    .from(mdTrade)
    .where(
      and(
        eq(mdTrade.exchange, env.EXCHANGE),
        eq(mdTrade.symbol, env.SYMBOL),
        gte(mdTrade.ts, env.START_TIME),
        lte(mdTrade.ts, env.END_TIME),
      ),
    )
    .orderBy(asc(mdTrade.ts));

  logger.info("Loaded data", { bboCount: bboData.length, tradeCount: tradeData.length });

  if (bboData.length === 0) {
    logger.error("No BBO data found for the specified period");
    process.exit(1);
  }

  // Strategy params
  const params: StrategyParams = {
    baseHalfSpreadBps: "10",
    volSpreadGain: "1",
    toxSpreadGain: "1",
    quoteSizeBase: "0.01",
    refreshIntervalMs: 1000,
    staleCancelMs: 5000,
    maxInventory: "1",
    inventorySkewGain: "5",
    pauseMarkIndexBps: "50",
    pauseLiqCount10s: 3,
  };

  // State
  let state: StrategyState = createInitialState(bboData[0].ts.getTime(), "NORMAL");
  let position: Position = { size: "0" };
  const activeOrders: SimulatedOrder[] = [];
  const fills: SimulatedFill[] = [];
  let cancelCount = 0;
  let pauseCount = 0;

  // Rolling windows
  const midSnapshots: MidSnapshot[] = [];
  const trades: TradeData[] = [];

  let tradeIndex = 0;

  // Process each BBO tick
  for (let i = 0; i < bboData.length; i++) {
    const bbo = bboData[i];
    const nowMs = bbo.ts.getTime();

    // Add mid snapshot
    midSnapshots.push({
      ts: nowMs,
      midPx: bbo.midPx,
    });

    // Prune old mid snapshots
    while (midSnapshots.length > 0 && midSnapshots[0].ts < nowMs - 10_000) {
      midSnapshots.shift();
    }

    // Add trades up to current time
    while (tradeIndex < tradeData.length && tradeData[tradeIndex].ts.getTime() <= nowMs) {
      const trade = tradeData[tradeIndex];
      trades.push({
        ts: trade.ts.getTime(),
        px: trade.px,
        sz: trade.sz,
        side: trade.side as "buy" | "sell" | undefined,
        type: trade.type as "normal" | "liq" | "delev" | undefined,
      });
      tradeIndex++;
    }

    // Prune old trades
    while (trades.length > 0 && trades[0].ts < nowMs - 10_000) {
      trades.shift();
    }

    // Check for simulated fills (touch fill)
    for (const trade of trades.filter(t => t.ts === nowMs)) {
      const tradePx = parseFloat(trade.px);

      for (let j = activeOrders.length - 1; j >= 0; j--) {
        const order = activeOrders[j];

        // Touch fill logic
        const shouldFill =
          (order.side === "buy" && tradePx <= order.price) || (order.side === "sell" && tradePx >= order.price);

        if (shouldFill) {
          // Execute fill
          const fillSize = order.size;
          const currentPos = parseFloat(position.size);
          const newPos = order.side === "buy" ? currentPos + fillSize : currentPos - fillSize;
          position = { size: newPos.toString() };

          fills.push({
            ts: new Date(nowMs),
            side: order.side,
            price: order.price,
            size: fillSize,
          });

          activeOrders.splice(j, 1);
        }
      }
    }

    // Throttle by tick interval
    if (i > 0 && nowMs - bboData[i - 1].ts.getTime() < env.TICK_INTERVAL_MS) {
      continue;
    }

    // Build snapshot
    const snapshot: Snapshot = {
      exchange: env.EXCHANGE,
      symbol: env.SYMBOL,
      nowMs,
      bestBidPx: bbo.bestBidPx,
      bestBidSz: bbo.bestBidSz,
      bestAskPx: bbo.bestAskPx,
      bestAskSz: bbo.bestAskSz,
      lastUpdateMs: nowMs,
    };

    // Compute features
    const trades1s = trades.filter(t => t.ts >= nowMs - 1000);
    const trades10s = trades.filter(t => t.ts >= nowMs - 10_000);
    const features = computeFeatures(snapshot, trades1s, trades10s, midSnapshots, params);

    // Run strategy
    const input: DecideInput = {
      nowMs,
      state,
      features,
      params,
      position,
    };

    const output = decide(input);

    // Track pause
    if (output.nextState.mode === "PAUSE" && state.mode !== "PAUSE") {
      pauseCount++;
    }

    state = output.nextState;

    // Process intents
    for (const intent of output.intents) {
      if (intent.type === "CANCEL_ALL") {
        cancelCount += activeOrders.length;
        activeOrders.length = 0;
      } else {
        // intent.type === "QUOTE"
        // Cancel existing and place new
        cancelCount += activeOrders.length;
        activeOrders.length = 0;

        activeOrders.push({
          side: "buy",
          price: parseFloat(intent.bidPx),
          size: parseFloat(intent.size),
          createdAtMs: nowMs,
        });

        activeOrders.push({
          side: "sell",
          price: parseFloat(intent.askPx),
          size: parseFloat(intent.size),
          createdAtMs: nowMs,
        });
      }
    }
  }

  // Calculate results
  const results: BacktestResults = {
    totalFills: fills.length,
    totalCancels: cancelCount,
    pauseCount,
    fills,
  };

  // Log results
  logger.info("Backtest completed", {
    totalFills: results.totalFills,
    totalCancels: results.totalCancels,
    pauseCount: results.pauseCount,
    finalPosition: position.size,
  });

  await pool.end();
}

main().catch(error => {
  logger.error("Fatal error", error);
  process.exit(1);
});
