/**
 * EventRepository Unit Tests
 *
 * Tests the factory function and error handling for order event and fill repositories.
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";

import { createPostgresEventRepository } from "../src/postgres/event-repository";
import type {
  EventRepository,
  OrderEventRecord,
  FillRecord,
} from "../src/interfaces/event-repository";

// ─────────────────────────────────────────────────────────────────────────────
// Mock DB
// ─────────────────────────────────────────────────────────────────────────────

function createMockDb() {
  const insertMock = mock(() => ({
    values: mock(() => Promise.resolve()),
  }));

  return {
    insert: insertMock,
  } as any;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("createPostgresEventRepository", () => {
  let db: ReturnType<typeof createMockDb>;
  let repo: EventRepository;

  beforeEach(() => {
    db = createMockDb();
    repo = createPostgresEventRepository(db);
  });

  it("should create repository with all required methods", () => {
    expect(repo.queueOrderEvent).toBeDefined();
    expect(repo.queueFill).toBeDefined();
    expect(repo.flush).toBeDefined();
    expect(repo.startPeriodicFlush).toBeDefined();
    expect(repo.stop).toBeDefined();
  });

  it("should have functions as methods", () => {
    expect(typeof repo.queueOrderEvent).toBe("function");
    expect(typeof repo.queueFill).toBe("function");
    expect(typeof repo.flush).toBe("function");
    expect(typeof repo.startPeriodicFlush).toBe("function");
    expect(typeof repo.stop).toBe("function");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// queueOrderEvent Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("EventRepository.queueOrderEvent", () => {
  const createSampleOrderEvent = (): OrderEventRecord => ({
    ts: new Date("2024-01-01T12:00:00Z"),
    exchange: "extended",
    symbol: "BTC-USD",
    clientOrderId: "client-123",
    exchangeOrderId: "order-123",
    eventType: "place",
    side: "buy",
    px: "50000",
    sz: "0.1",
    postOnly: true,
    reason: null,
    state: "NORMAL",
    paramsSetId: "params-123",
    rawJson: {},
  });

  it("should queue order event without throwing", () => {
    const db = createMockDb();
    const repo = createPostgresEventRepository(db);

    // queueOrderEvent should not throw
    expect(() => repo.queueOrderEvent(createSampleOrderEvent())).not.toThrow();
  });

  it("should queue multiple order events", () => {
    const db = createMockDb();
    const repo = createPostgresEventRepository(db);

    // Should handle multiple queued events
    expect(() => {
      repo.queueOrderEvent(createSampleOrderEvent());
      repo.queueOrderEvent(createSampleOrderEvent());
      repo.queueOrderEvent(createSampleOrderEvent());
    }).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// queueFill Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("EventRepository.queueFill", () => {
  const createSampleFill = (): FillRecord => ({
    ts: new Date("2024-01-01T12:00:00Z"),
    exchange: "extended",
    symbol: "BTC-USD",
    clientOrderId: "client-123",
    exchangeOrderId: "order-123",
    side: "buy",
    fillPx: "50000",
    fillSz: "0.1",
    fee: "0.01",
    liquidity: "maker",
    state: "NORMAL",
    paramsSetId: "params-123",
    rawJson: {},
  });

  it("should queue fill without throwing", () => {
    const db = createMockDb();
    const repo = createPostgresEventRepository(db);

    expect(() => repo.queueFill(createSampleFill())).not.toThrow();
  });

  it("should queue multiple fills", () => {
    const db = createMockDb();
    const repo = createPostgresEventRepository(db);

    expect(() => {
      repo.queueFill(createSampleFill());
      repo.queueFill(createSampleFill());
    }).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// flush Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("EventRepository.flush", () => {
  const createSampleOrderEvent = (): OrderEventRecord => ({
    ts: new Date("2024-01-01T12:00:00Z"),
    exchange: "extended",
    symbol: "BTC-USD",
    clientOrderId: "client-123",
    exchangeOrderId: "order-123",
    eventType: "place",
    side: "buy",
    px: "50000",
    sz: "0.1",
    postOnly: true,
    reason: null,
    state: "NORMAL",
    paramsSetId: "params-123",
    rawJson: {},
  });

  it("should return Ok when flush succeeds with no queued events", async () => {
    const db = createMockDb();
    const repo = createPostgresEventRepository(db);

    const result = await repo.flush();

    expect(result.isOk()).toBe(true);
  });

  it("should return Ok when flush succeeds with queued events", async () => {
    const db = createMockDb();
    const repo = createPostgresEventRepository(db);

    repo.queueOrderEvent(createSampleOrderEvent());

    const result = await repo.flush();

    expect(result.isOk()).toBe(true);
    expect(db.insert).toHaveBeenCalled();
  });

  it("should return Err with DB_ERROR when insert fails", async () => {
    const db = createMockDb();
    db.insert = mock(() => ({
      values: mock(() => Promise.reject(new Error("Connection refused"))),
    }));
    const repo = createPostgresEventRepository(db);

    repo.queueOrderEvent(createSampleOrderEvent());

    const result = await repo.flush();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("DB_ERROR");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// startPeriodicFlush Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("EventRepository.startPeriodicFlush", () => {
  it("should not throw when starting periodic flush", () => {
    const db = createMockDb();
    const repo = createPostgresEventRepository(db);

    expect(() => repo.startPeriodicFlush(1000)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stop Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("EventRepository.stop", () => {
  it("should return Ok when stopping with no queued events", async () => {
    const db = createMockDb();
    const repo = createPostgresEventRepository(db);

    const result = await repo.stop();

    expect(result.isOk()).toBe(true);
  });

  it("should flush remaining events before stopping", async () => {
    const db = createMockDb();
    const repo = createPostgresEventRepository(db);

    repo.queueOrderEvent({
      ts: new Date(),
      exchange: "extended",
      symbol: "BTC-USD",
      clientOrderId: "client-123",
      exchangeOrderId: "order-123",
      eventType: "place",
      side: "buy",
      px: "50000",
      sz: "0.1",
      postOnly: true,
      reason: null,
      state: "NORMAL",
      paramsSetId: "params-123",
      rawJson: {},
    });

    const result = await repo.stop();

    expect(result.isOk()).toBe(true);
    expect(db.insert).toHaveBeenCalled();
  });
});
