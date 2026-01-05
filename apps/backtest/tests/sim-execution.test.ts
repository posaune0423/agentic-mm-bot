/**
 * SimExecution Tests
 *
 * Requirements: 11.3
 * - Touch fill: BUY when trade_px <= bid_px
 * - Touch fill: SELL when trade_px >= ask_px
 * - Fill price is order price (not trade price)
 */

import { describe, expect, it } from "bun:test";
import { SimExecution } from "../src/sim/sim-execution";
import type { TradeData } from "@agentic-mm-bot/core";

describe("SimExecution", () => {
  describe("touch fill - BUY", () => {
    it("should fill BUY order when trade price <= bid price", () => {
      const simExec = new SimExecution();

      // Place bid at 100
      simExec.placeBid("100", "1", 1000);

      // Trade at 99 (below bid) should trigger fill
      const trades: TradeData[] = [{ ts: 2000, px: "99", sz: "0.5", side: "sell" }];

      const fills = simExec.checkTouchFill(trades, "100.5", "NORMAL", []);

      expect(fills.length).toBe(1);
      expect(fills[0].side).toBe("buy");
      expect(fills[0].orderPx).toBe("100"); // Fill at order price, not trade price
      expect(fills[0].size).toBe("1");
    });

    it("should fill BUY order when trade price equals bid price", () => {
      const simExec = new SimExecution();
      simExec.placeBid("100", "1", 1000);

      const trades: TradeData[] = [{ ts: 2000, px: "100", sz: "0.5", side: "sell" }];

      const fills = simExec.checkTouchFill(trades, "100.5", "NORMAL", []);

      expect(fills.length).toBe(1);
      expect(fills[0].orderPx).toBe("100");
    });

    it("should NOT fill BUY order when trade price > bid price", () => {
      const simExec = new SimExecution();
      simExec.placeBid("100", "1", 1000);

      const trades: TradeData[] = [{ ts: 2000, px: "101", sz: "0.5", side: "sell" }];

      const fills = simExec.checkTouchFill(trades, "100.5", "NORMAL", []);

      expect(fills.length).toBe(0);
    });
  });

  describe("touch fill - SELL", () => {
    it("should fill SELL order when trade price >= ask price", () => {
      const simExec = new SimExecution();

      // Place ask at 101
      simExec.placeAsk("101", "1", 1000);

      // Trade at 102 (above ask) should trigger fill
      const trades: TradeData[] = [{ ts: 2000, px: "102", sz: "0.5", side: "buy" }];

      const fills = simExec.checkTouchFill(trades, "100.5", "NORMAL", []);

      expect(fills.length).toBe(1);
      expect(fills[0].side).toBe("sell");
      expect(fills[0].orderPx).toBe("101"); // Fill at order price, not trade price
      expect(fills[0].size).toBe("1");
    });

    it("should fill SELL order when trade price equals ask price", () => {
      const simExec = new SimExecution();
      simExec.placeAsk("101", "1", 1000);

      const trades: TradeData[] = [{ ts: 2000, px: "101", sz: "0.5", side: "buy" }];

      const fills = simExec.checkTouchFill(trades, "100.5", "NORMAL", []);

      expect(fills.length).toBe(1);
      expect(fills[0].orderPx).toBe("101");
    });

    it("should NOT fill SELL order when trade price < ask price", () => {
      const simExec = new SimExecution();
      simExec.placeAsk("101", "1", 1000);

      const trades: TradeData[] = [{ ts: 2000, px: "100", sz: "0.5", side: "buy" }];

      const fills = simExec.checkTouchFill(trades, "100.5", "NORMAL", []);

      expect(fills.length).toBe(0);
    });
  });

  describe("position tracking", () => {
    it("should update position after BUY fill", () => {
      const simExec = new SimExecution();
      simExec.placeBid("100", "1", 1000);

      const trades: TradeData[] = [{ ts: 2000, px: "99", sz: "0.5" }];

      simExec.checkTouchFill(trades, "100.5", "NORMAL", []);

      const position = simExec.getPosition();
      expect(parseFloat(position.size)).toBe(1);
    });

    it("should update position after SELL fill", () => {
      const simExec = new SimExecution();
      simExec.placeAsk("101", "1", 1000);

      const trades: TradeData[] = [{ ts: 2000, px: "102", sz: "0.5" }];

      simExec.checkTouchFill(trades, "100.5", "NORMAL", []);

      const position = simExec.getPosition();
      expect(parseFloat(position.size)).toBe(-1);
    });
  });

  describe("cancel tracking", () => {
    it("should count cancels when placing new order over existing", () => {
      const simExec = new SimExecution();
      simExec.placeBid("100", "1", 1000);
      simExec.placeBid("101", "1", 2000); // Replaces existing

      const metrics = simExec.getMetrics();
      expect(metrics.cancelCount).toBe(1);
    });

    it("should count cancels on cancelAll", () => {
      const simExec = new SimExecution();
      simExec.placeBid("100", "1", 1000);
      simExec.placeAsk("101", "1", 1000);
      simExec.cancelAll();

      const metrics = simExec.getMetrics();
      expect(metrics.cancelCount).toBe(2);
    });
  });

  describe("pause tracking", () => {
    it("should count PAUSE transitions", () => {
      const simExec = new SimExecution();

      simExec.trackModeTransition("NORMAL");
      simExec.trackModeTransition("PAUSE");
      simExec.trackModeTransition("DEFENSIVE");
      simExec.trackModeTransition("PAUSE");

      const metrics = simExec.getMetrics();
      expect(metrics.pauseCount).toBe(2);
    });

    it("should not count consecutive PAUSE as multiple transitions", () => {
      const simExec = new SimExecution();

      simExec.trackModeTransition("NORMAL");
      simExec.trackModeTransition("PAUSE");
      simExec.trackModeTransition("PAUSE");
      simExec.trackModeTransition("PAUSE");

      const metrics = simExec.getMetrics();
      expect(metrics.pauseCount).toBe(1);
    });
  });
});
