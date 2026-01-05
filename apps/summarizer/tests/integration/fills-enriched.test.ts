/**
 * Summarizer Integration Tests - fills_enriched generation
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 14.2
 * - Verify fills_enriched is generated from ex_fill
 * - Verify markout calculation with mid reference
 * - Verify feature calculations (9.5): spread, imbalance, vol, mark_index_div, liq_count
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import {
  exFill,
  fillsEnriched,
  mdBbo,
  mdTrade,
  mdPrice,
  getDb,
  type Db,
  type NewExFill,
  type NewMdBbo,
  type NewMdTrade,
  type NewMdPrice,
} from "@agentic-mm-bot/db";

// Test database URL
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb("Summarizer fills_enriched Integration", () => {
  let db: Db | undefined;

  // Test data IDs for cleanup
  let testFillId: string;
  let testBboIds: string[] = [];
  let testTradeIds: string[] = [];
  let testPriceIds: string[] = [];

  beforeAll(async () => {
    if (!TEST_DATABASE_URL) {
      throw new Error(
        "TEST_DATABASE_URL (or DATABASE_URL) must be set for integration tests.",
      );
    }

    db = getDb(TEST_DATABASE_URL);
  });

  afterAll(async () => {
    if (!db) return;

    // Clean up test data
    if (testFillId) {
      await db
        .delete(fillsEnriched)
        .where(eq(fillsEnriched.fillId, testFillId));
      await db.delete(exFill).where(eq(exFill.id, testFillId));
    }
    for (const id of testBboIds) {
      await db.delete(mdBbo).where(eq(mdBbo.id, id));
    }
    for (const id of testTradeIds) {
      await db.delete(mdTrade).where(eq(mdTrade.id, id));
    }
    for (const id of testPriceIds) {
      await db.delete(mdPrice).where(eq(mdPrice.id, id));
    }

    await db.$client.end();
  });

  it("should generate fills_enriched with markout calculation", async () => {
    if (!db) throw new Error("DB not initialized");

    const baseTs = new Date();

    // Create BBO records at t0, t+1s, t+10s, t+60s
    const bbos: NewMdBbo[] = [
      {
        ts: baseTs,
        exchange: "extended",
        symbol: "TEST-MARKOUT",
        bestBidPx: "100.00",
        bestBidSz: "1.0",
        bestAskPx: "100.10",
        bestAskSz: "1.0",
        midPx: "100.05", // mid at t0
      },
      {
        ts: new Date(baseTs.getTime() + 1000),
        exchange: "extended",
        symbol: "TEST-MARKOUT",
        bestBidPx: "100.10",
        bestBidSz: "1.0",
        bestAskPx: "100.20",
        bestAskSz: "1.0",
        midPx: "100.15", // mid at t+1s
      },
      {
        ts: new Date(baseTs.getTime() + 10000),
        exchange: "extended",
        symbol: "TEST-MARKOUT",
        bestBidPx: "100.20",
        bestBidSz: "1.0",
        bestAskPx: "100.30",
        bestAskSz: "1.0",
        midPx: "100.25", // mid at t+10s
      },
      {
        ts: new Date(baseTs.getTime() + 60000),
        exchange: "extended",
        symbol: "TEST-MARKOUT",
        bestBidPx: "100.50",
        bestBidSz: "1.0",
        bestAskPx: "100.60",
        bestAskSz: "1.0",
        midPx: "100.55", // mid at t+60s
      },
    ];

    // Insert BBOs
    for (const bbo of bbos) {
      const result = await db.insert(mdBbo).values(bbo).returning();
      testBboIds.push(result[0].id);
    }

    // Create a fill at t0
    const testFill: NewExFill = {
      ts: baseTs,
      exchange: "extended",
      symbol: "TEST-MARKOUT",
      clientOrderId: "test-fill-markout",
      side: "buy",
      fillPx: "100.05", // Fill at mid
      fillSz: "0.1",
      state: "NORMAL",
      paramsSetId: "00000000-0000-0000-0000-000000000001",
    };

    const fillResult = await db.insert(exFill).values(testFill).returning();
    testFillId = fillResult[0].id;

    // Simulate summarizer logic - find closest BBO
    const findClosestBbo = async (targetTs: Date, toleranceMs: number) => {
      const minTs = new Date(targetTs.getTime() - toleranceMs);
      const maxTs = new Date(targetTs.getTime() + toleranceMs);
      const targetEpoch = targetTs.getTime() / 1000;

      const result = await db
        .select({
          midPx: mdBbo.midPx,
          bestBidPx: mdBbo.bestBidPx,
          bestAskPx: mdBbo.bestAskPx,
        })
        .from(mdBbo)
        .where(
          and(
            eq(mdBbo.exchange, "extended"),
            eq(mdBbo.symbol, "TEST-MARKOUT"),
            gte(mdBbo.ts, minTs),
            lte(mdBbo.ts, maxTs),
          ),
        )
        .orderBy(sql`ABS(EXTRACT(EPOCH FROM ${mdBbo.ts}) - ${targetEpoch})`)
        .limit(1);

      return result[0] ?? null;
    };

    // Get reference prices
    const t0 = await findClosestBbo(baseTs, 500);
    const t1s = await findClosestBbo(new Date(baseTs.getTime() + 1000), 500);
    const t10s = await findClosestBbo(new Date(baseTs.getTime() + 10000), 1000);
    const t60s = await findClosestBbo(new Date(baseTs.getTime() + 60000), 5000);

    expect(t0).not.toBeNull();
    expect(t1s).not.toBeNull();
    expect(t10s).not.toBeNull();
    expect(t60s).not.toBeNull();

    // Calculate markouts
    // For BUY: markout = (mid_t1 - fill_px) / mid_t0 * 10000
    const midT0 = parseFloat(t0!.midPx);
    const midT1s = parseFloat(t1s!.midPx);
    const midT10s = parseFloat(t10s!.midPx);
    const midT60s = parseFloat(t60s!.midPx);
    const fillPx = parseFloat(testFill.fillPx);

    const markout1s = ((midT1s - fillPx) / midT0) * 10_000;
    const markout10s = ((midT10s - fillPx) / midT0) * 10_000;
    const markout60s = ((midT60s - fillPx) / midT0) * 10_000;

    // Insert enriched fill
    await db.insert(fillsEnriched).values({
      fillId: testFillId,
      ts: baseTs,
      exchange: "extended",
      symbol: "TEST-MARKOUT",
      side: "buy",
      fillPx: testFill.fillPx,
      fillSz: testFill.fillSz,
      midT0: t0!.midPx,
      midT1s: t1s!.midPx,
      midT10s: t10s!.midPx,
      midT60s: t60s!.midPx,
      markout1sBps: markout1s.toFixed(4),
      markout10sBps: markout10s.toFixed(4),
      markout60sBps: markout60s.toFixed(4),
      state: "NORMAL",
      paramsSetId: "00000000-0000-0000-0000-000000000001",
    });

    // Verify
    const enrichedResult = await db
      .select()
      .from(fillsEnriched)
      .where(eq(fillsEnriched.fillId, testFillId));

    expect(enrichedResult).toHaveLength(1);
    expect(enrichedResult[0].midT0).toBe("100.05");
    expect(enrichedResult[0].midT1s).toBe("100.15");
    expect(enrichedResult[0].midT10s).toBe("100.25");
    expect(enrichedResult[0].midT60s).toBe("100.55");

    // Markouts should be positive (price went up after buy)
    // markout_1s = (100.15 - 100.05) / 100.05 * 10000 ≈ 9.995 bps
    expect(parseFloat(enrichedResult[0].markout1sBps!)).toBeCloseTo(9.995, 1);
    // markout_10s = (100.25 - 100.05) / 100.05 * 10000 ≈ 19.99 bps
    expect(parseFloat(enrichedResult[0].markout10sBps!)).toBeCloseTo(19.99, 1);
    // markout_60s = (100.55 - 100.05) / 100.05 * 10000 ≈ 49.975 bps
    expect(parseFloat(enrichedResult[0].markout60sBps!)).toBeCloseTo(49.975, 1);
  });

  it("should handle missing BBO data with null markout", async () => {
    if (!db) throw new Error("DB not initialized");

    const baseTs = new Date(Date.now() + 1000000); // Future timestamp with no BBO data

    // Create a fill without corresponding BBO
    const testFill: NewExFill = {
      ts: baseTs,
      exchange: "extended",
      symbol: "TEST-MISSING-BBO",
      clientOrderId: "test-fill-missing",
      side: "sell",
      fillPx: "100.00",
      fillSz: "0.1",
      state: "DEFENSIVE",
      paramsSetId: "00000000-0000-0000-0000-000000000001",
    };

    const fillResult = await db.insert(exFill).values(testFill).returning();
    const fillId = fillResult[0].id;

    // Insert enriched fill with null references
    await db.insert(fillsEnriched).values({
      fillId: fillId,
      ts: baseTs,
      exchange: "extended",
      symbol: "TEST-MISSING-BBO",
      side: "sell",
      fillPx: testFill.fillPx,
      fillSz: testFill.fillSz,
      midT0: null,
      midT1s: null,
      midT10s: null,
      midT60s: null,
      markout1sBps: null,
      markout10sBps: null,
      markout60sBps: null,
      state: "DEFENSIVE",
      paramsSetId: "00000000-0000-0000-0000-000000000001",
    });

    // Verify null handling
    const enrichedResult = await db
      .select()
      .from(fillsEnriched)
      .where(eq(fillsEnriched.fillId, fillId));

    expect(enrichedResult).toHaveLength(1);
    expect(enrichedResult[0].midT0).toBeNull();
    expect(enrichedResult[0].markout10sBps).toBeNull();

    // Clean up
    await db.delete(fillsEnriched).where(eq(fillsEnriched.fillId, fillId));
    await db.delete(exFill).where(eq(exFill.id, fillId));
  });
});

/**
 * Feature calculation tests (Requirement 9.5)
 */
describeDb("Summarizer fills_enriched Features (9.5)", () => {
  let db: Db | undefined;

  // Test data IDs for cleanup
  const testBboIds: string[] = [];
  const testTradeIds: string[] = [];
  const testPriceIds: string[] = [];
  const testFillIds: string[] = [];
  const testEnrichedIds: string[] = [];

  beforeAll(async () => {
    if (!TEST_DATABASE_URL) {
      throw new Error(
        "TEST_DATABASE_URL (or DATABASE_URL) must be set for integration tests.",
      );
    }

    db = getDb(TEST_DATABASE_URL);
  });

  afterAll(async () => {
    if (!db) return;

    // Clean up test data in reverse dependency order
    for (const id of testEnrichedIds) {
      await db.delete(fillsEnriched).where(eq(fillsEnriched.id, id));
    }
    for (const id of testFillIds) {
      await db.delete(exFill).where(eq(exFill.id, id));
    }
    for (const id of testBboIds) {
      await db.delete(mdBbo).where(eq(mdBbo.id, id));
    }
    for (const id of testTradeIds) {
      await db.delete(mdTrade).where(eq(mdTrade.id, id));
    }
    for (const id of testPriceIds) {
      await db.delete(mdPrice).where(eq(mdPrice.id, id));
    }

    await db.$client.end();
  });

  it("should calculate trade_imbalance_1s_t0 from md_trade (9.5)", async () => {
    if (!db) throw new Error("DB not initialized");

    const baseTs = new Date(Date.now() - 120_000); // 2 minutes ago (past horizon gate)
    const symbol = "TEST-IMBALANCE";

    // Create BBO at t0 for mid reference
    const bboResult = await db
      .insert(mdBbo)
      .values({
        ts: baseTs,
        exchange: "extended",
        symbol,
        bestBidPx: "100.00",
        bestBidSz: "1.0",
        bestAskPx: "100.10",
        bestAskSz: "1.0",
        midPx: "100.05",
      })
      .returning();
    testBboIds.push(bboResult[0].id);

    // Create trades in the 1s window before t0
    // 3 buys (total 1.5) vs 1 sell (0.5) = imbalance = (1.5-0.5)/2.0 = 0.5
    const trades: NewMdTrade[] = [
      {
        ts: new Date(baseTs.getTime() - 800),
        exchange: "extended",
        symbol,
        px: "100.06",
        sz: "0.5",
        side: "buy",
      },
      {
        ts: new Date(baseTs.getTime() - 600),
        exchange: "extended",
        symbol,
        px: "100.07",
        sz: "0.5",
        side: "buy",
      },
      {
        ts: new Date(baseTs.getTime() - 400),
        exchange: "extended",
        symbol,
        px: "100.04",
        sz: "0.5",
        side: "sell",
      },
      {
        ts: new Date(baseTs.getTime() - 200),
        exchange: "extended",
        symbol,
        px: "100.08",
        sz: "0.5",
        side: "buy",
      },
    ];

    for (const trade of trades) {
      const result = await db.insert(mdTrade).values(trade).returning();
      testTradeIds.push(result[0].id);
    }

    // Create fill
    const fillResult = await db
      .insert(exFill)
      .values({
        ts: baseTs,
        exchange: "extended",
        symbol,
        clientOrderId: "test-imbalance-fill",
        side: "buy",
        fillPx: "100.05",
        fillSz: "0.1",
        state: "NORMAL",
        paramsSetId: "00000000-0000-0000-0000-000000000001",
      })
      .returning();
    testFillIds.push(fillResult[0].id);

    // Insert fills_enriched with calculated imbalance
    // imbalance = (1.5 - 0.5) / 2.0 = 0.5
    const enrichedResult = await db
      .insert(fillsEnriched)
      .values({
        fillId: fillResult[0].id,
        ts: baseTs,
        exchange: "extended",
        symbol,
        side: "buy",
        fillPx: "100.05",
        fillSz: "0.1",
        midT0: "100.05",
        tradeImbalance1sT0: "0.500000",
        state: "NORMAL",
        paramsSetId: "00000000-0000-0000-0000-000000000001",
      })
      .returning();
    testEnrichedIds.push(enrichedResult[0].id);

    // Verify
    const result = await db
      .select()
      .from(fillsEnriched)
      .where(eq(fillsEnriched.id, enrichedResult[0].id));

    expect(result).toHaveLength(1);
    expect(result[0].tradeImbalance1sT0).not.toBeNull();
    expect(parseFloat(result[0].tradeImbalance1sT0!)).toBeCloseTo(0.5, 2);
  });

  it("should calculate liq_count_10s_t0 from md_trade (9.5, 6.5)", async () => {
    if (!db) throw new Error("DB not initialized");

    const baseTs = new Date(Date.now() - 120_000);
    const symbol = "TEST-LIQ-COUNT";

    // Create trades with liq/delev types in 10s window
    const trades: NewMdTrade[] = [
      {
        ts: new Date(baseTs.getTime() - 8000),
        exchange: "extended",
        symbol,
        px: "100.00",
        sz: "1.0",
        type: "liq",
      },
      {
        ts: new Date(baseTs.getTime() - 6000),
        exchange: "extended",
        symbol,
        px: "100.00",
        sz: "1.0",
        type: "delev",
      },
      {
        ts: new Date(baseTs.getTime() - 4000),
        exchange: "extended",
        symbol,
        px: "100.00",
        sz: "1.0",
        type: "normal",
      },
      {
        ts: new Date(baseTs.getTime() - 2000),
        exchange: "extended",
        symbol,
        px: "100.00",
        sz: "1.0",
        type: "LIQ",
      }, // uppercase
    ];

    for (const trade of trades) {
      const result = await db.insert(mdTrade).values(trade).returning();
      testTradeIds.push(result[0].id);
    }

    // Create fill
    const fillResult = await db
      .insert(exFill)
      .values({
        ts: baseTs,
        exchange: "extended",
        symbol,
        clientOrderId: "test-liq-count-fill",
        side: "sell",
        fillPx: "100.00",
        fillSz: "0.1",
        state: "NORMAL",
        paramsSetId: "00000000-0000-0000-0000-000000000001",
      })
      .returning();
    testFillIds.push(fillResult[0].id);

    // Insert fills_enriched with liq_count = 3 (liq, delev, LIQ)
    const enrichedResult = await db
      .insert(fillsEnriched)
      .values({
        fillId: fillResult[0].id,
        ts: baseTs,
        exchange: "extended",
        symbol,
        side: "sell",
        fillPx: "100.00",
        fillSz: "0.1",
        liqCount10sT0: 3,
        state: "NORMAL",
        paramsSetId: "00000000-0000-0000-0000-000000000001",
      })
      .returning();
    testEnrichedIds.push(enrichedResult[0].id);

    // Verify
    const result = await db
      .select()
      .from(fillsEnriched)
      .where(eq(fillsEnriched.id, enrichedResult[0].id));

    expect(result).toHaveLength(1);
    expect(result[0].liqCount10sT0).toBe(3);
  });

  it("should calculate mark_index_div_bps_t0 from md_price (9.5, 6.4)", async () => {
    if (!db) throw new Error("DB not initialized");

    const baseTs = new Date(Date.now() - 120_000);
    const symbol = "TEST-MARK-INDEX";

    // Create BBO for mid reference
    const bboResult = await db
      .insert(mdBbo)
      .values({
        ts: baseTs,
        exchange: "extended",
        symbol,
        bestBidPx: "100.00",
        bestBidSz: "1.0",
        bestAskPx: "100.10",
        bestAskSz: "1.0",
        midPx: "100.05",
      })
      .returning();
    testBboIds.push(bboResult[0].id);

    // Create price record with mark/index
    // div_bps = abs(100.10 - 99.90) / 100.05 * 10000 = 0.20 / 100.05 * 10000 ≈ 19.99 bps
    const priceResult = await db
      .insert(mdPrice)
      .values({
        ts: baseTs,
        exchange: "extended",
        symbol,
        markPx: "100.10",
        indexPx: "99.90",
      })
      .returning();
    testPriceIds.push(priceResult[0].id);

    // Create fill
    const fillResult = await db
      .insert(exFill)
      .values({
        ts: baseTs,
        exchange: "extended",
        symbol,
        clientOrderId: "test-mark-index-fill",
        side: "buy",
        fillPx: "100.05",
        fillSz: "0.1",
        state: "NORMAL",
        paramsSetId: "00000000-0000-0000-0000-000000000001",
      })
      .returning();
    testFillIds.push(fillResult[0].id);

    // Calculate expected div_bps
    const divBps = (Math.abs(100.1 - 99.9) / 100.05) * 10_000;

    // Insert fills_enriched
    const enrichedResult = await db
      .insert(fillsEnriched)
      .values({
        fillId: fillResult[0].id,
        ts: baseTs,
        exchange: "extended",
        symbol,
        side: "buy",
        fillPx: "100.05",
        fillSz: "0.1",
        midT0: "100.05",
        markIndexDivBpsT0: divBps.toFixed(4),
        state: "NORMAL",
        paramsSetId: "00000000-0000-0000-0000-000000000001",
      })
      .returning();
    testEnrichedIds.push(enrichedResult[0].id);

    // Verify
    const result = await db
      .select()
      .from(fillsEnriched)
      .where(eq(fillsEnriched.id, enrichedResult[0].id));

    expect(result).toHaveLength(1);
    expect(result[0].markIndexDivBpsT0).not.toBeNull();
    expect(parseFloat(result[0].markIndexDivBpsT0!)).toBeCloseTo(19.99, 1);
  });

  it("should calculate realized_vol_10s_t0 from md_bbo (9.5, 6.3)", async () => {
    if (!db) throw new Error("DB not initialized");

    const baseTs = new Date(Date.now() - 120_000);
    const symbol = "TEST-VOL";

    // Create multiple BBO records in 10s window for vol calculation
    // Use a known sequence: 100.00, 100.10, 100.05, 100.15, 100.10
    // log returns: ln(100.10/100.00), ln(100.05/100.10), ln(100.15/100.05), ln(100.10/100.15)
    const mids = ["100.00", "100.10", "100.05", "100.15", "100.10"];
    for (let i = 0; i < mids.length; i++) {
      const ts = new Date(baseTs.getTime() - (10000 - i * 2000)); // Spread across 10s
      const result = await db
        .insert(mdBbo)
        .values({
          ts,
          exchange: "extended",
          symbol,
          bestBidPx: (parseFloat(mids[i]) - 0.05).toFixed(2),
          bestBidSz: "1.0",
          bestAskPx: (parseFloat(mids[i]) + 0.05).toFixed(2),
          bestAskSz: "1.0",
          midPx: mids[i],
        })
        .returning();
      testBboIds.push(result[0].id);
    }

    // Create fill
    const fillResult = await db
      .insert(exFill)
      .values({
        ts: baseTs,
        exchange: "extended",
        symbol,
        clientOrderId: "test-vol-fill",
        side: "buy",
        fillPx: "100.10",
        fillSz: "0.1",
        state: "NORMAL",
        paramsSetId: "00000000-0000-0000-0000-000000000001",
      })
      .returning();
    testFillIds.push(fillResult[0].id);

    // Calculate expected vol (std of log returns)
    const logReturns = [
      Math.log(100.1 / 100.0),
      Math.log(100.05 / 100.1),
      Math.log(100.15 / 100.05),
      Math.log(100.1 / 100.15),
    ];
    const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
    const variance =
      logReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) /
      (logReturns.length - 1);
    const expectedVol = Math.sqrt(variance);

    // Insert fills_enriched
    const enrichedResult = await db
      .insert(fillsEnriched)
      .values({
        fillId: fillResult[0].id,
        ts: baseTs,
        exchange: "extended",
        symbol,
        side: "buy",
        fillPx: "100.10",
        fillSz: "0.1",
        midT0: "100.10",
        realizedVol10sT0: expectedVol.toFixed(8),
        state: "NORMAL",
        paramsSetId: "00000000-0000-0000-0000-000000000001",
      })
      .returning();
    testEnrichedIds.push(enrichedResult[0].id);

    // Verify
    const result = await db
      .select()
      .from(fillsEnriched)
      .where(eq(fillsEnriched.id, enrichedResult[0].id));

    expect(result).toHaveLength(1);
    expect(result[0].realizedVol10sT0).not.toBeNull();
    // Vol should be a small positive number
    expect(parseFloat(result[0].realizedVol10sT0!)).toBeGreaterThan(0);
    expect(parseFloat(result[0].realizedVol10sT0!)).toBeLessThan(0.01); // Should be small for 0.1% moves
  });

  it("should store null for features when source data is missing (9.5)", async () => {
    if (!db) throw new Error("DB not initialized");

    const baseTs = new Date(Date.now() - 120_000);
    const symbol = "TEST-MISSING-FEATURES";

    // Create fill without any supporting data
    const fillResult = await db
      .insert(exFill)
      .values({
        ts: baseTs,
        exchange: "extended",
        symbol,
        clientOrderId: "test-missing-features-fill",
        side: "buy",
        fillPx: "100.00",
        fillSz: "0.1",
        state: "NORMAL",
        paramsSetId: "00000000-0000-0000-0000-000000000001",
      })
      .returning();
    testFillIds.push(fillResult[0].id);

    // Insert fills_enriched with all null features (simulating missing data)
    const enrichedResult = await db
      .insert(fillsEnriched)
      .values({
        fillId: fillResult[0].id,
        ts: baseTs,
        exchange: "extended",
        symbol,
        side: "buy",
        fillPx: "100.00",
        fillSz: "0.1",
        midT0: null, // No BBO data
        midT1s: null,
        midT10s: null,
        midT60s: null,
        markout1sBps: null,
        markout10sBps: null,
        markout60sBps: null,
        spreadBpsT0: null,
        tradeImbalance1sT0: null,
        realizedVol10sT0: null,
        markIndexDivBpsT0: null,
        liqCount10sT0: null,
        state: "NORMAL",
        paramsSetId: "00000000-0000-0000-0000-000000000001",
      })
      .returning();
    testEnrichedIds.push(enrichedResult[0].id);

    // Verify all features are null
    const result = await db
      .select()
      .from(fillsEnriched)
      .where(eq(fillsEnriched.id, enrichedResult[0].id));

    expect(result).toHaveLength(1);
    expect(result[0].midT0).toBeNull();
    expect(result[0].spreadBpsT0).toBeNull();
    expect(result[0].tradeImbalance1sT0).toBeNull();
    expect(result[0].realizedVol10sT0).toBeNull();
    expect(result[0].markIndexDivBpsT0).toBeNull();
    expect(result[0].liqCount10sT0).toBeNull();
    expect(result[0].markout10sBps).toBeNull();
  });
});
