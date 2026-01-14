import { describe, expect, test } from "bun:test";

import { LogLevel, logger, type LogRecord } from "../../src/logger";

describe("logger sink routing", () => {
  test("when a sink is set, INFO logs are routed to the sink and not to console", () => {
    const records: LogRecord[] = [];
    const originalInfo = console.info;

    console.info = (() => {
      throw new Error("console.info should not be called when sink is set");
    }) as typeof console.info;

    try {
      logger.setSink({ write: r => records.push(r) });
      logger.info("hello", { a: 1 });

      expect(records.length).toBe(1);
      expect(records[0]?.level).toBe(LogLevel.INFO);
      expect(records[0]?.message).toContain("hello");
    } finally {
      logger.clearSink();
      console.info = originalInfo;
    }
  });
});
