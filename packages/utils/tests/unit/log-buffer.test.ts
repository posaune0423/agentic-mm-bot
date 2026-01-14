import { describe, expect, test } from "bun:test";

import { LogBuffer } from "../../src/cli-dashboard/log-buffer";
import { LogLevel, type LogRecord } from "../../src/logger";

describe("LogBuffer", () => {
  test("keeps only the latest N records", () => {
    const buf = new LogBuffer(3);
    const r = (i: number): LogRecord => ({
      tsMs: 1000 + i,
      level: LogLevel.INFO,
      message: `m${i}`,
    });

    buf.push(r(1));
    buf.push(r(2));
    buf.push(r(3));
    expect(buf.latest(10).map(x => x.message)).toEqual(["m1", "m2", "m3"]);

    buf.push(r(4));
    expect(buf.latest(10).map(x => x.message)).toEqual(["m2", "m3", "m4"]);
  });
});
