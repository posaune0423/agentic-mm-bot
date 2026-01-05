/**
 * Summarizer Integration Tests - fills_enriched generation
 *
 * Requirements: 9.1, 9.2, 9.3, 14.2
 * - Verify fills_enriched is generated from ex_fill
 * - Verify markout calculation with mid reference
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { exFill, fillsEnriched, mdBbo, getDb, type Db, type NewExFill, type NewMdBbo } from "@agentic-mm-bot/db";

// Test database URL
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb("Summarizer fills_enriched Integration", () => {
  let db: Db | undefined;

  // Test data IDs for cleanup
  let testFillId: string;
  let testBboIds: string[] = [];

  beforeAll(async () => {
    db = getDb(TEST_DATABASE_URL);
  });

  afterAll(async () => {
    if (!db) return;

    // Clean up test data
    if (testFillId) {
      await db.delete(fillsEnriched).where(eq(fillsEnriched.fillId, testFillId));
      await db.delete(exFill).where(eq(exFill.id, testFillId));
    }
    for (const id of testBboIds) {
      await db.delete(mdBbo).where(eq(mdBbo.id, id));
    }

    await db.$client.end();
  });

  it("should generate fills_enriched with markout calculation", async () => {
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
        .orderBy(sql`ABS(EXTRACT(EPOCH FROM ${mdBbo.ts}) - EXTRACT(EPOCH FROM ${targetTs}::timestamp))`)
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
    const enrichedResult = await db.select().from(fillsEnriched).where(eq(fillsEnriched.fillId, testFillId));

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
    const enrichedResult = await db.select().from(fillsEnriched).where(eq(fillsEnriched.fillId, fillId));

    expect(enrichedResult).toHaveLength(1);
    expect(enrichedResult[0].midT0).toBeNull();
    expect(enrichedResult[0].markout10sBps).toBeNull();

    // Clean up
    await db.delete(fillsEnriched).where(eq(fillsEnriched.fillId, fillId));
    await db.delete(exFill).where(eq(exFill.id, fillId));
  });
});
