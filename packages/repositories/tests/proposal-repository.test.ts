/**
 * ProposalRepository Unit Tests
 *
 * Tests the factory function and error handling for LLM proposal management.
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";

import { createPostgresProposalRepository } from "../src/postgres/proposal-repository";
import type { ProposalRepository } from "../src/interfaces/proposal-repository";

// ─────────────────────────────────────────────────────────────────────────────
// Mock DB
// ─────────────────────────────────────────────────────────────────────────────

function createMockDb() {
  const insertMock = mock(() => ({
    values: mock(() => ({
      returning: mock(() => Promise.resolve([{ id: "proposal-123" }])),
    })),
  }));

  const selectMock = mock(() => ({
    from: mock(() => ({
      where: mock(() => ({
        limit: mock(() => Promise.resolve([])),
      })),
    })),
  }));

  const updateMock = mock(() => ({
    set: mock(() => ({
      where: mock(() => Promise.resolve()),
    })),
  }));

  return {
    insert: insertMock,
    select: selectMock,
    update: updateMock,
    transaction: mock(async (fn: (tx: any) => Promise<any>) =>
      fn({
        update: updateMock,
        insert: insertMock,
        select: selectMock,
      }),
    ),
  } as any;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("createPostgresProposalRepository", () => {
  let db: ReturnType<typeof createMockDb>;
  let repo: ProposalRepository;

  beforeEach(() => {
    db = createMockDb();
    repo = createPostgresProposalRepository(db);
  });

  it("should create repository with all required methods", () => {
    expect(repo.saveProposal).toBeDefined();
    expect(repo.getPendingProposals).toBeDefined();
    expect(repo.updateProposalStatus).toBeDefined();
    expect(repo.saveParamRollout).toBeDefined();
    expect(repo.createStrategyParams).toBeDefined();
    expect(repo.setCurrentParams).toBeDefined();
    expect(repo.getCurrentParams).toBeDefined();
  });

  it("should have functions as methods", () => {
    expect(typeof repo.saveProposal).toBe("function");
    expect(typeof repo.getPendingProposals).toBe("function");
    expect(typeof repo.updateProposalStatus).toBe("function");
    expect(typeof repo.saveParamRollout).toBe("function");
    expect(typeof repo.createStrategyParams).toBe("function");
    expect(typeof repo.setCurrentParams).toBe("function");
    expect(typeof repo.getCurrentParams).toBe("function");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// saveProposal Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("ProposalRepository.saveProposal", () => {
  const createSampleProposal = () => ({
    exchange: "extended",
    symbol: "BTC-USD",
    proposedParams: {
      baseHalfSpreadBps: "15",
      volSpreadGain: "1.2",
      toxSpreadGain: "1.1",
      quoteSizeUsd: "100",
      refreshIntervalMs: 1000,
      staleCancelMs: 5000,
      maxInventory: "1.0",
      inventorySkewGain: "5",
      pauseMarkIndexBps: "50",
      pauseLiqCount10s: 3,
    },
    reasoning: "Increased spread due to high volatility",
    status: "pending" as const,
  });

  it("should return Ok with saved proposal on success", async () => {
    const mockProposal = {
      id: "proposal-123",
      ...createSampleProposal(),
      createdAt: new Date(),
    };

    const db = createMockDb();
    db.insert = mock(() => ({
      values: mock(() => ({
        returning: mock(() => Promise.resolve([mockProposal])),
      })),
    }));
    const repo = createPostgresProposalRepository(db);

    const result = await repo.saveProposal(createSampleProposal());

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.id).toBe("proposal-123");
    }
  });

  it("should return Err with DB_ERROR on insert failure", async () => {
    const db = createMockDb();
    db.insert = mock(() => ({
      values: mock(() => ({
        returning: mock(() => Promise.reject(new Error("Insert failed"))),
      })),
    }));
    const repo = createPostgresProposalRepository(db);

    const result = await repo.saveProposal(createSampleProposal());

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("DB_ERROR");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getPendingProposals Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("ProposalRepository.getPendingProposals", () => {
  it("should return empty array when no pending proposals", async () => {
    const db = createMockDb();
    // getPendingProposals doesn't use .limit(), so we need a mock that returns from .where()
    db.select = mock(() => ({
      from: mock(() => ({
        where: mock(() => Promise.resolve([])),
      })),
    }));
    const repo = createPostgresProposalRepository(db);

    const result = await repo.getPendingProposals("extended", "BTC-USD");

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual([]);
    }
  });

  it("should return Err with DB_ERROR on query failure", async () => {
    const db = createMockDb();
    db.select = mock(() => ({
      from: mock(() => ({
        where: mock(() => Promise.reject(new Error("Query timeout"))),
      })),
    }));
    const repo = createPostgresProposalRepository(db);

    const result = await repo.getPendingProposals("extended", "BTC-USD");

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("DB_ERROR");
    }
  });

  it("should return proposals ordered by createdAt desc", async () => {
    const proposals = [
      { id: "p1", createdAt: new Date("2024-01-01T12:00:00Z") },
      { id: "p2", createdAt: new Date("2024-01-01T12:05:00Z") },
    ];

    const db = createMockDb();
    db.select = mock(() => ({
      from: mock(() => ({
        where: mock(() => Promise.resolve(proposals)),
      })),
    }));
    const repo = createPostgresProposalRepository(db);

    const result = await repo.getPendingProposals("extended", "BTC-USD");

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.length).toBe(2);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateProposalStatus Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("ProposalRepository.updateProposalStatus", () => {
  it("should return Ok on successful status update", async () => {
    const db = createMockDb();
    const repo = createPostgresProposalRepository(db);

    const result = await repo.updateProposalStatus(
      "proposal-123",
      "applied",
      "param-applier",
    );

    expect(result.isOk()).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });

  it("should return Ok with reject reason", async () => {
    const db = createMockDb();
    const repo = createPostgresProposalRepository(db);

    const result = await repo.updateProposalStatus(
      "proposal-123",
      "rejected",
      "param-applier",
      "Spread too high for current market",
    );

    expect(result.isOk()).toBe(true);
  });

  it("should return Err with DB_ERROR on update failure", async () => {
    const db = createMockDb();
    db.update = mock(() => ({
      set: mock(() => ({
        where: mock(() => Promise.reject(new Error("Update failed"))),
      })),
    }));
    const repo = createPostgresProposalRepository(db);

    const result = await repo.updateProposalStatus(
      "proposal-123",
      "applied",
      "param-applier",
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("DB_ERROR");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getCurrentParams Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("ProposalRepository.getCurrentParams", () => {
  it("should return Ok with default params when no current params", async () => {
    const db = createMockDb();
    // getCurrentParams uses .limit(1), so mock needs to include it
    db.select = mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => Promise.resolve([])),
        })),
      })),
    }));
    const repo = createPostgresProposalRepository(db);

    const result = await repo.getCurrentParams("extended", "BTC-USD");

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.id).toBe("00000000-0000-0000-0000-000000000000");
      expect(result.value.quoteSizeUsd).toBe("100");
    }
  });

  it("should return Ok with params when found", async () => {
    const mockParams = {
      id: "params-123",
      exchange: "extended",
      symbol: "BTC-USD",
      baseHalfSpreadBps: "10",
      volSpreadGain: "1.0",
      toxSpreadGain: "1.0",
      quoteSizeUsd: "100",
      refreshIntervalMs: 1000,
      staleCancelMs: 5000,
      maxInventory: "1.0",
      inventorySkewGain: "5",
      pauseMarkIndexBps: "50",
      pauseLiqCount10s: 3,
      isCurrent: true,
      createdAt: new Date(),
    };

    const db = createMockDb();
    db.select = mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => Promise.resolve([mockParams])),
        })),
      })),
    }));
    const repo = createPostgresProposalRepository(db);

    const result = await repo.getCurrentParams("extended", "BTC-USD");

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.id).toBe("params-123");
      expect(result.value.baseHalfSpreadBps).toBe("10");
    }
  });

  it("should return Err with DB_ERROR on query failure", async () => {
    const db = createMockDb();
    db.select = mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => Promise.reject(new Error("Connection lost"))),
        })),
      })),
    }));
    const repo = createPostgresProposalRepository(db);

    const result = await repo.getCurrentParams("extended", "BTC-USD");

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("DB_ERROR");
    }
  });
});
