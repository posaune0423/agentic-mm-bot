/**
 * Simulated Execution - Touch fill simulation
 *
 * Requirements: 11.3
 * - BUY: next trade_px <= bid_px → fill at bid_px (maker)
 * - SELL: next trade_px >= ask_px → fill at ask_px (maker)
 * - Fill price is the order price (not trade price)
 */

import type { Ms, Position, PriceStr, Side, SizeStr, StrategyMode, ReasonCode, TradeData } from "@agentic-mm-bot/core";

/**
 * Simulated order
 */
export interface SimOrder {
  clientOrderId: string;
  side: Side;
  price: PriceStr;
  size: SizeStr;
  createdAtMs: Ms;
}

/**
 * Simulated fill record
 */
export interface SimFill {
  ts: Date;
  side: Side;
  orderPx: PriceStr;
  size: SizeStr;
  midT0: PriceStr;
  mode: StrategyMode;
  reasonCodes: ReasonCode[];
}

/**
 * Simulated Execution State
 *
 * Tracks orders, position, and metrics during backtest.
 */
export class SimExecution {
  private bidOrder: SimOrder | undefined;
  private askOrder: SimOrder | undefined;
  private position: Position = { size: "0" };

  private fills: SimFill[] = [];
  private cancelCount = 0;
  private pauseTransitions = 0;
  private lastMode: StrategyMode = "PAUSE";

  private orderIdCounter = 0;

  /**
   * Generate a unique order ID
   */
  generateOrderId(): string {
    this.orderIdCounter++;
    return `sim_${String(this.orderIdCounter)}`;
  }

  /**
   * Place a bid order (cancels existing bid if any)
   */
  placeBid(price: PriceStr, size: SizeStr, createdAtMs: Ms): void {
    if (this.bidOrder) {
      this.cancelCount++;
    }

    this.bidOrder = {
      clientOrderId: this.generateOrderId(),
      side: "buy",
      price,
      size,
      createdAtMs,
    };
  }

  /**
   * Place an ask order (cancels existing ask if any)
   */
  placeAsk(price: PriceStr, size: SizeStr, createdAtMs: Ms): void {
    if (this.askOrder) {
      this.cancelCount++;
    }

    this.askOrder = {
      clientOrderId: this.generateOrderId(),
      side: "sell",
      price,
      size,
      createdAtMs,
    };
  }

  /**
   * Cancel all orders
   */
  cancelAll(): void {
    if (this.bidOrder) this.cancelCount++;
    if (this.askOrder) this.cancelCount++;

    this.bidOrder = undefined;
    this.askOrder = undefined;
  }

  /**
   * Check trades for touch fill
   *
   * Requirements: 11.3
   * - BUY: trade_px <= bid_px → fill
   * - SELL: trade_px >= ask_px → fill
   */
  checkTouchFill(trades: TradeData[], midPx: PriceStr, mode: StrategyMode, reasonCodes: ReasonCode[]): SimFill[] {
    const newFills: SimFill[] = [];

    for (const trade of trades) {
      const tradePx = Number.parseFloat(trade.px);

      // Check bid order
      if (this.bidOrder) {
        const bidPrice = Number.parseFloat(this.bidOrder.price);
        if (tradePx <= bidPrice) {
          // Fill at order price (maker)
          const fill = this.executeFill(this.bidOrder, new Date(trade.ts), midPx, mode, reasonCodes);
          newFills.push(fill);
          this.bidOrder = undefined;
        }
      }

      // Check ask order
      if (this.askOrder) {
        const askPrice = Number.parseFloat(this.askOrder.price);
        if (tradePx >= askPrice) {
          // Fill at order price (maker)
          const fill = this.executeFill(this.askOrder, new Date(trade.ts), midPx, mode, reasonCodes);
          newFills.push(fill);
          this.askOrder = undefined;
        }
      }
    }

    return newFills;
  }

  /**
   * Execute a fill
   */
  private executeFill(
    order: SimOrder,
    ts: Date,
    midT0: PriceStr,
    mode: StrategyMode,
    reasonCodes: ReasonCode[],
  ): SimFill {
    const fill: SimFill = {
      ts,
      side: order.side,
      orderPx: order.price,
      size: order.size,
      midT0,
      mode,
      reasonCodes,
    };

    // Update position
    const currentPos = Number.parseFloat(this.position.size);
    const fillSize = Number.parseFloat(order.size);
    const signedFill = order.side === "buy" ? fillSize : -fillSize;
    this.position = { size: (currentPos + signedFill).toString() };

    this.fills.push(fill);
    return fill;
  }

  /**
   * Track mode transition for PAUSE count
   */
  trackModeTransition(newMode: StrategyMode): void {
    if (newMode === "PAUSE" && this.lastMode !== "PAUSE") {
      this.pauseTransitions++;
    }
    this.lastMode = newMode;
  }

  /**
   * Get current position
   */
  getPosition(): Position {
    return this.position;
  }

  /**
   * Get bid order
   */
  getBidOrder(): SimOrder | undefined {
    return this.bidOrder;
  }

  /**
   * Get ask order
   */
  getAskOrder(): SimOrder | undefined {
    return this.askOrder;
  }

  /**
   * Get all fills
   */
  getFills(): SimFill[] {
    return this.fills;
  }

  /**
   * Get metrics
   */
  getMetrics(): { fillCount: number; cancelCount: number; pauseCount: number } {
    return {
      fillCount: this.fills.length,
      cancelCount: this.cancelCount,
      pauseCount: this.pauseTransitions,
    };
  }

  /**
   * Check if order is stale
   */
  isOrderStale(order: SimOrder, nowMs: Ms, staleCancelMs: Ms): boolean {
    return nowMs - order.createdAtMs > staleCancelMs;
  }
}
