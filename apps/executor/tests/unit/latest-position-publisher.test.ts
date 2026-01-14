/**
 * latest_position publisher tests
 */

import { describe, it, expect } from "bun:test";

import * as services from "../../src/services";

describe("latest_position publisher", () => {
  it("should export buildLatestPositionState", () => {
    expect((services as any).buildLatestPositionState).toBeDefined();
    expect(typeof (services as any).buildLatestPositionState).toBe("function");
  });
});
