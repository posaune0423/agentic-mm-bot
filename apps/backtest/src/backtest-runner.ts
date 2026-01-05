/**
 * Backtest Runner - Main orchestration for backtest execution
 *
 * Requirements: 11.1-11.4
 * - Replay md_* data with fixed tick interval
 * - Use same core strategy logic
 * - Simulated execution (touch fill)
 * - Output metrics and CSV
 */

import {
  computeFeatures,
  createInitialState,
  decide,
  type DecideInput,
  type StrategyParams,
  type StrategyState,
} from "@agentic-mm-bot/core";
import type { MarketDataRepository } from "@agentic-mm-bot/repositories";
import { logger } from "@agentic-mm-bot/utils";

import { loadMarketData, mergeToEventStream, type MarketEvent } from "./data/event-stream";
import { MarketDataState } from "./data/market-data-state";
import { SimExecution } from "./sim/sim-execution";
import { executeSimActions, planSimActions } from "./sim/action-planner";
import { calculateAverageMarkout, enrichFillsWithMarkout, type EnrichedFill } from "./report/markout";
import { writeFillsCsv } from "./report/csv-writer";

/**
 * Backtest configuration
 */
export interface BacktestConfig {
  exchange: string;
  symbol: string;
  startTime: Date;
  endTime: Date;
  tickIntervalMs: number;
  params: StrategyParams;
  outputCsvPath?: string;
}

/**
 * Backtest results
 */
export interface BacktestResults {
  totalFills: number;
  totalCancels: number;
  pauseCount: number;
  avgMarkout10sBps: number | null;
  fills: EnrichedFill[];
  finalPosition: string;
}

/**
 * Run backtest
 *
 * @param repo - Market data repository
 * @param config - Backtest configuration
 * @returns Backtest results
 */
export async function runBacktest(repo: MarketDataRepository, config: BacktestConfig): Promise<BacktestResults> {
  const { exchange, symbol, startTime, endTime, tickIntervalMs, params, outputCsvPath } = config;

  // Step 1: Load market data
  logger.info("Loading market data", {
    exchange,
    symbol,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
  });

  const marketData = await loadMarketData(repo, {
    exchange,
    symbol,
    startTime,
    endTime,
  });

  logger.info("Data loaded", {
    bboCount: marketData.bboData.length,
    tradeCount: marketData.tradeData.length,
    priceCount: marketData.priceData.length,
  });

  if (marketData.bboData.length === 0) {
    throw new Error(
      `No BBO data found for the specified period: exchange=${exchange}, symbol=${symbol}, startTime=${startTime.toISOString()}, endTime=${endTime.toISOString()}`,
    );
  }

  // Step 2: Merge into event stream
  const events = mergeToEventStream(marketData);
  logger.info("Event stream created", { eventCount: events.length });

  // Step 3: Initialize state
  const marketState = new MarketDataState(exchange, symbol);
  const simExec = new SimExecution();
  let strategyState: StrategyState = createInitialState(startTime.getTime(), "NORMAL");

  // Step 4: Run fixed-tick simulation
  const startMs = startTime.getTime();
  const endMs = endTime.getTime();
  let eventIndex = 0;
  let lastQuoteMs: number | undefined;

  logger.info("Starting simulation", { startMs, endMs, tickIntervalMs });

  for (let tickMs = startMs; tickMs <= endMs; tickMs += tickIntervalMs) {
    // Process all events up to current tick time
    while (eventIndex < events.length && events[eventIndex].ts.getTime() <= tickMs) {
      const event = events[eventIndex];
      processEvent(event, marketState);
      eventIndex++;
    }

    // Prune old data from windows
    marketState.pruneOldData(tickMs);

    // Skip if no valid data yet
    if (!marketState.hasValidData()) {
      continue;
    }

    // Get trades that arrived since last tick for touch fill checking
    const recentTrades = marketState.getTradesInWindow(tickMs, tickIntervalMs);

    // Check for touch fills before decision
    const fills = simExec.checkTouchFill(recentTrades, marketState.getMidPx(), strategyState.mode, []);

    if (fills.length > 0) {
      logger.debug("Touch fills executed", { count: fills.length });
    }

    // Build snapshot
    const snapshot = marketState.getSnapshot(tickMs);

    // Get trades for feature calculation
    const trades1s = marketState.getTradesInWindow(tickMs, 1000);
    const trades10s = marketState.getTradesInWindow(tickMs, 10_000);
    const midSnapshots10s = marketState.getMidSnapshotsInWindow(tickMs, 10_000);

    // Compute features
    const features = computeFeatures(snapshot, trades1s, trades10s, midSnapshots10s, params);

    // Get position
    const position = simExec.getPosition();

    // Run strategy decision
    const input: DecideInput = {
      nowMs: tickMs,
      state: strategyState,
      features,
      params,
      position,
    };

    const output = decide(input);

    // Track mode transition
    simExec.trackModeTransition(output.nextState.mode);

    // Update strategy state
    strategyState = output.nextState;

    // Plan and execute actions
    for (const intent of output.intents) {
      const actions = planSimActions(intent, simExec, lastQuoteMs, tickMs, params, features.midPx);
      executeSimActions(actions, simExec, tickMs);

      // Update last quote time if we placed orders
      if (intent.type === "QUOTE") {
        lastQuoteMs = tickMs;
      }
    }
  }

  // Step 5: Calculate markout for fills
  logger.info("Calculating markout for fills");
  const enrichedFills = enrichFillsWithMarkout(simExec.getFills(), marketData.bboData);
  const avgMarkout = calculateAverageMarkout(enrichedFills);

  // Step 6: Output CSV if path specified
  if (outputCsvPath) {
    logger.info("Writing fills to CSV", { path: outputCsvPath });
    writeFillsCsv(enrichedFills, outputCsvPath);
  }

  // Step 7: Get metrics
  const metrics = simExec.getMetrics();

  return {
    totalFills: metrics.fillCount,
    totalCancels: metrics.cancelCount,
    pauseCount: metrics.pauseCount,
    avgMarkout10sBps: avgMarkout,
    fills: enrichedFills,
    finalPosition: simExec.getPosition().size,
  };
}

/**
 * Process a market event
 */
function processEvent(event: MarketEvent, marketState: MarketDataState): void {
  switch (event.type) {
    case "bbo":
      marketState.updateBbo(event.data);
      break;
    case "trade":
      marketState.addTrade(event.data);
      break;
    case "price":
      marketState.updatePrice(event.data);
      break;
  }
}
