/**
 * Health route tests.
 * Minimal route test - verifies endpoint returns expected response.
 */

import { describe, expect, it } from "bun:test";

import { health } from "../../../src/routes/health";

describe("GET /health", () => {
  it("should return ok status", async () => {
    const response = await health.request("/");

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      timestamp: string;
    };
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeDefined();
  });

  it("should return valid ISO timestamp", async () => {
    const response = await health.request("/");
    const body = (await response.json()) as {
      status: string;
      timestamp: string;
    };

    const timestamp = new Date(body.timestamp);
    expect(timestamp.toISOString()).toBe(body.timestamp);
  });
});
