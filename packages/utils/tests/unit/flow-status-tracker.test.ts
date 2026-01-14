import { describe, expect, test } from "bun:test";

import { FlowStatusTracker } from "../../src/cli-dashboard/flow-status-tracker";

describe("FlowStatusTracker", () => {
  test("tracks phase transitions with last duration", () => {
    const t = new FlowStatusTracker<"IDLE" | "READ" | "EXECUTE">("IDLE", 1000);

    expect(t.snapshot()).toEqual({
      phase: "IDLE",
      sinceMs: 1000,
      lastTransitionMs: 1000,
      lastDurationMs: undefined,
    });

    t.enterPhase("READ", 1500);
    expect(t.snapshot()).toEqual({
      phase: "READ",
      sinceMs: 1500,
      lastTransitionMs: 1500,
      lastDurationMs: 500,
    });

    // Same phase should be a no-op.
    t.enterPhase("READ", 2000);
    expect(t.snapshot()).toEqual({
      phase: "READ",
      sinceMs: 1500,
      lastTransitionMs: 1500,
      lastDurationMs: 500,
    });
  });
});
