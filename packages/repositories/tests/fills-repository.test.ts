/**
 * FillsRepository Unit Tests
 *
 * Tests the factory function and error handling.
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";

import { createPostgresFillsRepository } from "../src/postgres/fills-repository";
import type {
  FillsRepository,
  EnrichedFillInsert,
} from "../src/interfaces/fills-repository";

// ─────────────────────────────────────────────────────────────────────────────
// Mock DB
// ─────────────────────────────────────────────────────────────────────────────

function createMockDb() {
  const insertMock = mock(() => ({
    values: mock(() => Promise.resolve()),
  }));

  const selectMock = mock(() => ({
    from: mock(() => ({
      leftJoin: mock(() => ({
        where: mock(() => ({
          limit: mock(() => Promise.resolve([])),
        })),
      })),
    })),
  }));

  return {
    insert: insertMock,
    select: selectMock,
  } as any;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("createPostgresFillsRepository", () => {
  let db: ReturnType<typeof createMockDb>;
  let repo: FillsRepository;

  beforeEach(() => {
    db = createMockDb();
    repo = createPostgresFillsRepository(db);
  });

  it("should create repository with all required methods", () => {
    expect(repo.getUnprocessedFills).toBeDefined();
    expect(repo.insertEnrichedFill).toBeDefined();
    expect(repo.insertEnrichedFillBatch).toBeDefined();
  });

  it("should have functions as methods", () => {
    expect(typeof repo.getUnprocessedFills).toBe("function");
    expect(typeof repo.insertEnrichedFill).toBe("function");
    expect(typeof repo.insertEnrichedFillBatch).toBe("function");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getUnprocessedFills Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("FillsRepository.getUnprocessedFills", () => {
  it("should return empty array when no unprocessed fills", async () => {
    const db = createMockDb();
    const repo = createPostgresFillsRepository(db);

    const result = await repo.getUnprocessedFills(new Date(), 100);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual([]);
    }
  });

  it("should return Err with DB_ERROR on query failure", async () => {
    const db = createMockDb();
    db.select = mock(() => ({
      from: mock(() => ({
        leftJoin: mock(() => ({
          where: mock(() => ({
            limit: mock(() => Promise.reject(new Error("Connection failed"))),
          })),
        })),
      })),
    }));
    const repo = createPostgresFillsRepository(db);

    const result = await repo.getUnprocessedFills(new Date(), 100);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("DB_ERROR");
      expect(result.error.message).toContain("Connection failed");
    }
  });

  it("should transform query results correctly", async () => {
    const mockFill = {
      id: "fill-123",
      ts: new Date("2024-01-01T12:00:00Z"),
      exchange: "extended",
      symbol: "BTC-USD",
      side: "buy",
      fillPx: "50000",
      fillSz: "0.1",
      state: "NORMAL",
      paramsSetId: "params-123",
    };

    const db = createMockDb();
    db.select = mock(() => ({
      from: mock(() => ({
        leftJoin: mock(() => ({
          where: mock(() => ({
            limit: mock(() =>
              Promise.resolve([
                { ex_fill: mockFill },
                { ex_fill: { ...mockFill, id: "fill-456" } },
              ]).then((rows) => rows),
            ),
          })),
        })),
      })),
    }));
    const repo = createPostgresFillsRepository(db);

    const result = await repo.getUnprocessedFills(new Date(), 100);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.length).toBe(2);
      expect(result.value[0].id).toBe("fill-123");
      expect(result.value[1].id).toBe("fill-456");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// insertEnrichedFill Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("FillsRepository.insertEnrichedFill", () => {
  const createSampleFill = (): EnrichedFillInsert => ({
    fillId: "fill-123",
    ts: new Date("2024-01-01T12:00:00Z"),
    exchange: "extended",
    symbol: "BTC-USD",
    side: "buy",
    fillPx: "50000",
    fillSz: "0.1",
    midT0: "50005",
    midT1s: "50010",
    midT10s: "50020",
    midT60s: "50050",
    markout1sBps: "1.00",
    markout10sBps: "3.00",
    markout60sBps: "10.00",
    spreadBpsT0: "2.00",
    tradeImbalance1sT0: "0.15",
    realizedVol10sT0: "0.0001",
    markIndexDivBpsT0: "0.50",
    liqCount10sT0: 0,
    state: "NORMAL",
    paramsSetId: "params-123",
  });

  it("should return Ok on successful insert", async () => {
    const db = createMockDb();
    const repo = createPostgresFillsRepository(db);

    const result = await repo.insertEnrichedFill(createSampleFill());

    expect(result.isOk()).toBe(true);
    expect(db.insert).toHaveBeenCalled();
  });

  it("should return Err with DB_ERROR on insert failure", async () => {
    const db = createMockDb();
    db.insert = mock(() => ({
      values: mock(() =>
        Promise.reject(new Error("Unique constraint violation")),
      ),
    }));
    const repo = createPostgresFillsRepository(db);

    const result = await repo.insertEnrichedFill(createSampleFill());

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("DB_ERROR");
      expect(result.error.message).toContain("Unique constraint violation");
    }
  });

  it("should handle null optional fields", async () => {
    const db = createMockDb();
    const repo = createPostgresFillsRepository(db);

    const fillWithNulls: EnrichedFillInsert = {
      fillId: "fill-123",
      ts: new Date(),
      exchange: "extended",
      symbol: "BTC-USD",
      side: "buy",
      fillPx: "50000",
      fillSz: "0.1",
      midT0: null,
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
      paramsSetId: "params-123",
    };

    const result = await repo.insertEnrichedFill(fillWithNulls);

    expect(result.isOk()).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// insertEnrichedFillBatch Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("FillsRepository.insertEnrichedFillBatch", () => {
  const createSampleFill = (id: string): EnrichedFillInsert => ({
    fillId: id,
    ts: new Date("2024-01-01T12:00:00Z"),
    exchange: "extended",
    symbol: "BTC-USD",
    side: "buy",
    fillPx: "50000",
    fillSz: "0.1",
    midT0: "50005",
    state: "NORMAL",
    paramsSetId: "params-123",
  });

  it("should return Ok for empty array without calling db", async () => {
    const db = createMockDb();
    const repo = createPostgresFillsRepository(db);

    const result = await repo.insertEnrichedFillBatch([]);

    expect(result.isOk()).toBe(true);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("should return Ok on successful batch insert", async () => {
    const db = createMockDb();
    const repo = createPostgresFillsRepository(db);

    const fills = [
      createSampleFill("fill-1"),
      createSampleFill("fill-2"),
      createSampleFill("fill-3"),
    ];

    const result = await repo.insertEnrichedFillBatch(fills);

    expect(result.isOk()).toBe(true);
    expect(db.insert).toHaveBeenCalled();
  });

  it("should return Err with DB_ERROR on batch insert failure", async () => {
    const db = createMockDb();
    db.insert = mock(() => ({
      values: mock(() => Promise.reject(new Error("Batch insert failed"))),
    }));
    const repo = createPostgresFillsRepository(db);

    const fills = [createSampleFill("fill-1"), createSampleFill("fill-2")];

    const result = await repo.insertEnrichedFillBatch(fills);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("DB_ERROR");
      expect(result.error.message).toContain("Batch insert failed");
    }
  });
});
