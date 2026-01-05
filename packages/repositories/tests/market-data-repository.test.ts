/**
 * MarketDataRepository Unit Tests
 *
 * Tests the factory function and error handling.
 * Integration tests with real DB are in separate integration test files.
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";

import { createPostgresMarketDataRepository } from "../src/postgres/market-data-repository";
import type {
  MarketDataRepository,
  BboInsert,
  TradeInsert,
  PriceInsert,
  LatestTopState,
} from "../src/interfaces/market-data-repository";

// ─────────────────────────────────────────────────────────────────────────────
// Mock DB
// ─────────────────────────────────────────────────────────────────────────────

function createMockDb() {
  const insertMock = mock(() => ({
    values: mock(() => Promise.resolve()),
    onConflictDoUpdate: mock(() => Promise.resolve()),
  }));

  const selectMock = mock(() => ({
    from: mock(() => ({
      where: mock(() => ({
        orderBy: mock(() => ({
          limit: mock(() => Promise.resolve([])),
        })),
        limit: mock(() => Promise.resolve([])),
      })),
    })),
  }));

  return {
    insert: insertMock,
    select: selectMock,
    $client: { end: mock(() => Promise.resolve()) },
  } as any;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("createPostgresMarketDataRepository", () => {
  let db: ReturnType<typeof createMockDb>;
  let repo: MarketDataRepository;

  beforeEach(() => {
    db = createMockDb();
    repo = createPostgresMarketDataRepository(db);
  });

  it("should create repository with all required methods", () => {
    expect(repo.insertBboBatch).toBeDefined();
    expect(repo.insertTradeBatch).toBeDefined();
    expect(repo.insertPriceBatch).toBeDefined();
    expect(repo.upsertLatestTop).toBeDefined();
    expect(repo.findClosestBbo).toBeDefined();
    expect(repo.findClosestPrice).toBeDefined();
    expect(repo.getTradesInWindow).toBeDefined();
    expect(repo.getBbosInWindow).toBeDefined();
    expect(repo.loadMarketData).toBeDefined();
  });

  it("should have functions as methods, not undefined", () => {
    expect(typeof repo.insertBboBatch).toBe("function");
    expect(typeof repo.insertTradeBatch).toBe("function");
    expect(typeof repo.insertPriceBatch).toBe("function");
    expect(typeof repo.upsertLatestTop).toBe("function");
    expect(typeof repo.findClosestBbo).toBe("function");
    expect(typeof repo.findClosestPrice).toBe("function");
    expect(typeof repo.getTradesInWindow).toBe("function");
    expect(typeof repo.getBbosInWindow).toBe("function");
    expect(typeof repo.loadMarketData).toBe("function");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Insert Batch Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("MarketDataRepository.insertBboBatch", () => {
  it("should return Ok for empty array without calling db", async () => {
    const db = createMockDb();
    const repo = createPostgresMarketDataRepository(db);

    const result = await repo.insertBboBatch([]);

    expect(result.isOk()).toBe(true);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("should return Err with DB_ERROR on insert failure", async () => {
    const db = createMockDb();
    db.insert = mock(() => ({
      values: mock(() => Promise.reject(new Error("Connection refused"))),
    }));
    const repo = createPostgresMarketDataRepository(db);

    const bboRecord: BboInsert = {
      ts: new Date(),
      exchange: "extended",
      symbol: "BTC-USD",
      bestBidPx: "50000",
      bestBidSz: "1.0",
      bestAskPx: "50010",
      bestAskSz: "1.0",
      midPx: "50005",
    };

    const result = await repo.insertBboBatch([bboRecord]);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("DB_ERROR");
      expect(result.error.message).toContain("Connection refused");
    }
  });
});

describe("MarketDataRepository.insertTradeBatch", () => {
  it("should return Ok for empty array without calling db", async () => {
    const db = createMockDb();
    const repo = createPostgresMarketDataRepository(db);

    const result = await repo.insertTradeBatch([]);

    expect(result.isOk()).toBe(true);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("should return Err with DB_ERROR on insert failure", async () => {
    const db = createMockDb();
    db.insert = mock(() => ({
      values: mock(() => Promise.reject(new Error("Timeout"))),
    }));
    const repo = createPostgresMarketDataRepository(db);

    const tradeRecord: TradeInsert = {
      ts: new Date(),
      exchange: "extended",
      symbol: "BTC-USD",
      tradeId: "trade-123",
      side: "buy",
      px: "50000",
      sz: "0.1",
    };

    const result = await repo.insertTradeBatch([tradeRecord]);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("DB_ERROR");
    }
  });
});

describe("MarketDataRepository.insertPriceBatch", () => {
  it("should return Ok for empty array without calling db", async () => {
    const db = createMockDb();
    const repo = createPostgresMarketDataRepository(db);

    const result = await repo.insertPriceBatch([]);

    expect(result.isOk()).toBe(true);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("should return Err with DB_ERROR on insert failure", async () => {
    const db = createMockDb();
    db.insert = mock(() => ({
      values: mock(() => Promise.reject(new Error("Disk full"))),
    }));
    const repo = createPostgresMarketDataRepository(db);

    const priceRecord: PriceInsert = {
      ts: new Date(),
      exchange: "extended",
      symbol: "BTC-USD",
      markPx: "50000",
      indexPx: "50005",
    };

    const result = await repo.insertPriceBatch([priceRecord]);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("DB_ERROR");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Upsert Latest Top Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("MarketDataRepository.upsertLatestTop", () => {
  it("should return Err with DB_ERROR on upsert failure", async () => {
    const db = createMockDb();
    db.insert = mock(() => ({
      values: mock(() => ({
        onConflictDoUpdate: mock(() =>
          Promise.reject(new Error("Constraint violation")),
        ),
      })),
    }));
    const repo = createPostgresMarketDataRepository(db);

    const state: LatestTopState = {
      exchange: "extended",
      symbol: "BTC-USD",
      ts: new Date(),
      bestBidPx: "50000",
      bestBidSz: "1.0",
      bestAskPx: "50010",
      bestAskSz: "1.0",
      midPx: "50005",
    };

    const result = await repo.upsertLatestTop(state);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("DB_ERROR");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Find Closest Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("MarketDataRepository.findClosestBbo", () => {
  it("should return Ok(null) when no BBO found in range", async () => {
    const db = createMockDb();
    const repo = createPostgresMarketDataRepository(db);

    const result = await repo.findClosestBbo(
      "extended",
      "BTC-USD",
      new Date(),
      1000,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBeNull();
    }
  });

  it("should return Err with DB_ERROR on query failure", async () => {
    const db = createMockDb();
    db.select = mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          orderBy: mock(() => ({
            limit: mock(() => Promise.reject(new Error("Query timeout"))),
          })),
        })),
      })),
    }));
    const repo = createPostgresMarketDataRepository(db);

    const result = await repo.findClosestBbo(
      "extended",
      "BTC-USD",
      new Date(),
      1000,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("DB_ERROR");
      expect(result.error.message).toContain("Query timeout");
    }
  });

  it("should calculate spreadBps correctly when BBO found", async () => {
    const db = createMockDb();
    db.select = mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          orderBy: mock(() => ({
            limit: mock(() =>
              Promise.resolve([
                {
                  midPx: "100.00",
                  bestBidPx: "99.50",
                  bestAskPx: "100.50",
                  ts: new Date(),
                },
              ]),
            ),
          })),
        })),
      })),
    }));
    const repo = createPostgresMarketDataRepository(db);

    const result = await repo.findClosestBbo(
      "extended",
      "BTC-USD",
      new Date(),
      1000,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk() && result.value) {
      // spread = (100.50 - 99.50) / 100.00 * 10000 = 100 bps
      expect(parseFloat(result.value.spreadBps)).toBeCloseTo(100, 1);
      expect(result.value.midPx).toBe("100.00");
      expect(result.value.bestBidPx).toBe("99.50");
      expect(result.value.bestAskPx).toBe("100.50");
    }
  });
});

describe("MarketDataRepository.findClosestPrice", () => {
  it("should return Ok(null) when no Price found in range", async () => {
    const db = createMockDb();
    const repo = createPostgresMarketDataRepository(db);

    const result = await repo.findClosestPrice(
      "extended",
      "BTC-USD",
      new Date(),
      1000,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBeNull();
    }
  });

  it("should return Err with DB_ERROR on query failure", async () => {
    const db = createMockDb();
    db.select = mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          orderBy: mock(() => ({
            limit: mock(() => Promise.reject(new Error("Connection lost"))),
          })),
        })),
      })),
    }));
    const repo = createPostgresMarketDataRepository(db);

    const result = await repo.findClosestPrice(
      "extended",
      "BTC-USD",
      new Date(),
      1000,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("DB_ERROR");
    }
  });

  it("should return PriceRef with mark and index prices", async () => {
    const mockTs = new Date("2024-01-01T12:00:00Z");
    const db = createMockDb();
    db.select = mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          orderBy: mock(() => ({
            limit: mock(() =>
              Promise.resolve([
                {
                  markPx: "50000.00",
                  indexPx: "50005.00",
                  ts: mockTs,
                },
              ]),
            ),
          })),
        })),
      })),
    }));
    const repo = createPostgresMarketDataRepository(db);

    const result = await repo.findClosestPrice(
      "extended",
      "BTC-USD",
      new Date(),
      1000,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk() && result.value) {
      expect(result.value.markPx).toBe("50000.00");
      expect(result.value.indexPx).toBe("50005.00");
      expect(result.value.ts).toEqual(mockTs);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Window Query Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("MarketDataRepository.getTradesInWindow", () => {
  it("should return Err with DB_ERROR on query failure", async () => {
    const db = createMockDb();
    db.select = mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          orderBy: mock(() => Promise.reject(new Error("Deadlock detected"))),
        })),
      })),
    }));
    const repo = createPostgresMarketDataRepository(db);

    const result = await repo.getTradesInWindow(
      "extended",
      "BTC-USD",
      new Date("2024-01-01T00:00:00Z"),
      new Date("2024-01-01T00:01:00Z"),
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("DB_ERROR");
    }
  });
});

describe("MarketDataRepository.getBbosInWindow", () => {
  it("should return Err with DB_ERROR on query failure", async () => {
    const db = createMockDb();
    db.select = mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          orderBy: mock(() => ({
            limit: mock(() => Promise.reject(new Error("Memory exceeded"))),
          })),
        })),
      })),
    }));
    const repo = createPostgresMarketDataRepository(db);

    const result = await repo.getBbosInWindow(
      "extended",
      "BTC-USD",
      new Date("2024-01-01T00:00:00Z"),
      new Date("2024-01-01T00:01:00Z"),
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("DB_ERROR");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Load Market Data Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("MarketDataRepository.loadMarketData", () => {
  it("should return Err with DB_ERROR when any query fails", async () => {
    const db = createMockDb();
    db.select = mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          orderBy: mock(() =>
            Promise.reject(new Error("Connection pool exhausted")),
          ),
        })),
      })),
    }));
    const repo = createPostgresMarketDataRepository(db);

    const result = await repo.loadMarketData(
      "extended",
      "BTC-USD",
      new Date("2024-01-01T00:00:00Z"),
      new Date("2024-01-01T01:00:00Z"),
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("DB_ERROR");
    }
  });
});
