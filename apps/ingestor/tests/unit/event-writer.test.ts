/**
 * EventWriter Unit Tests
 *
 * - Flush should not drop buffered events on insert failure
 * - Flush should retry inserts with exponential backoff
 * - Permanent failures should move events to dead letter buffer
 * - Concurrent flush calls should not duplicate inserts
 */

import { describe, expect, test } from "bun:test";

import type { Db } from "@agentic-mm-bot/db";
import { mdBbo, mdPrice, mdTrade } from "@agentic-mm-bot/db";

import { EventWriter } from "../../src/services/event-writer";

type InsertCall = { table: unknown; values: unknown[] };

class FakeDb {
  readonly calls: InsertCall[] = [];

  constructor(
    private readonly impl: (table: unknown, values: unknown[]) => Promise<void>,
  ) {}

  insert(table: unknown): { values: (values: unknown[]) => Promise<void> } {
    return {
      values: async (values: unknown[]): Promise<void> => {
        this.calls.push({ table, values });
        await this.impl(table, values);
      },
    };
  }
}

describe("EventWriter", () => {
  test("flush should remove items only after successful insert", async () => {
    const fakeDb = new FakeDb(async () => {});
    const writer = new EventWriter(fakeDb as unknown as Db, {
      retryBaseDelayMs: 0,
    });

    writer.addBbo({
      ts: new Date("2026-01-01T00:00:00.000Z"),
      exchange: "test",
      symbol: "BTC-USD",
      bestBidPx: "1",
      bestBidSz: "2",
      bestAskPx: "3",
      bestAskSz: "4",
      midPx: "2",
      rawJson: { ok: true },
    });

    await writer.flush();

    expect(writer.getBufferSizes().bbo).toBe(0);
    expect(writer.getDeadLetterSize()).toBe(0);
    expect(fakeDb.calls.length).toBe(1);
    expect(fakeDb.calls[0]?.table).toBe(mdBbo);
    expect(fakeDb.calls[0]?.values.length).toBe(1);
  });

  test("flush should retry and eventually succeed", async () => {
    let tradeAttempts = 0;
    const fakeDb = new FakeDb(async (table) => {
      if (table !== mdTrade) return;
      tradeAttempts++;
      if (tradeAttempts < 3) throw new Error("temporary failure");
    });

    const writer = new EventWriter(fakeDb as unknown as Db, {
      retryBaseDelayMs: 0,
    });
    writer.addTrade({
      ts: new Date("2026-01-01T00:00:00.000Z"),
      exchange: "test",
      symbol: "BTC-USD",
      px: "10",
      sz: "1",
      rawJson: { ok: true },
    });

    await writer.flush();

    expect(tradeAttempts).toBe(3);
    expect(writer.getBufferSizes().trade).toBe(0);
    expect(writer.getDeadLetterSize()).toBe(0);
  });

  test("flush should move events to dead letter after max retries", async () => {
    let priceAttempts = 0;
    const fakeDb = new FakeDb(async (table) => {
      if (table !== mdPrice) return;
      priceAttempts++;
      throw new Error("permanent failure");
    });

    const writer = new EventWriter(fakeDb as unknown as Db, {
      retryBaseDelayMs: 0,
    });
    writer.addPrice({
      ts: new Date("2026-01-01T00:00:00.000Z"),
      exchange: "test",
      symbol: "BTC-USD",
      markPx: "100",
      indexPx: "101",
      rawJson: { ok: true },
    });

    await writer.flush();

    expect(priceAttempts).toBe(3);
    expect(writer.getBufferSizes().price).toBe(0);
    expect(writer.getDeadLetterSize()).toBe(1);
  });

  test("concurrent flush calls should not duplicate inserts", async () => {
    let resolveBbo: (() => void) | null = null;
    let bboAttempts = 0;

    const fakeDb = new FakeDb(async (table) => {
      if (table !== mdBbo) return;
      bboAttempts++;
      await new Promise<void>((resolve) => {
        resolveBbo = resolve;
      });
    });

    const writer = new EventWriter(fakeDb as unknown as Db, {
      retryBaseDelayMs: 0,
    });
    writer.addBbo({
      ts: new Date("2026-01-01T00:00:00.000Z"),
      exchange: "test",
      symbol: "BTC-USD",
      bestBidPx: "1",
      bestBidSz: "2",
      bestAskPx: "3",
      bestAskSz: "4",
      midPx: "2",
      rawJson: { ok: true },
    });

    const p1 = writer.flush();
    const p2 = writer.flush();

    // release the pending insert
    resolveBbo?.();

    await Promise.all([p1, p2]);

    expect(bboAttempts).toBe(1);
    expect(writer.getBufferSizes().bbo).toBe(0);
  });
});
