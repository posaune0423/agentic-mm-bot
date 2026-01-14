/**
 * latest_position publisher helpers
 *
 * Requirements: 4.4, 12.4
 * - Build a latest_position upsert payload from in-memory trackers
 */

import type { LatestPositionState } from "@agentic-mm-bot/repositories";

import type { PositionTracker } from "./position-tracker";

export function buildLatestPositionState(args: {
  exchange: string;
  symbol: string;
  positionTracker: PositionTracker;
  nowMs: number;
}): LatestPositionState {
  const { exchange, symbol, positionTracker, nowMs } = args;
  const tsMs = positionTracker.getLastUpdateMs() || nowMs;

  return {
    exchange,
    symbol,
    ts: new Date(tsMs),
    positionSz: positionTracker.getPosition().size,
    entryPx: positionTracker.getEntryPrice() ?? null,
    unrealizedPnl: positionTracker.getUnrealizedPnl() ?? null,
  };
}
