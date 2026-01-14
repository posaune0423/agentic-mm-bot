import { describe, expect, test } from "bun:test";

import { createDashboardControl } from "../../src/cli-dashboard/dashboard-control";

describe("createDashboardControl", () => {
  test("disables dashboard when stdout is not TTY", () => {
    const ctrl = createDashboardControl({
      enabled: true,
      refreshMs: 250,
      noColor: false,
      isTTY: false,
    });

    expect(ctrl.config().enabled).toBe(false);
  });
});
