/**
 * PositionRepository Unit Tests
 *
 * This repository is responsible for maintaining latest_position.
 */

import { describe, it, expect } from "bun:test";

import * as postgres from "../src/postgres";

describe("PositionRepository exports", () => {
  it("should export createPostgresPositionRepository", () => {
    expect((postgres as any).createPostgresPositionRepository).toBeDefined();
    expect(typeof (postgres as any).createPostgresPositionRepository).toBe("function");
  });
});
