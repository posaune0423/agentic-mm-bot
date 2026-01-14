import type { LogRecord } from "../logger";

/**
 * Fixed-size ring buffer for dashboard log rendering.
 */
export class LogBuffer {
  private readonly max: number;
  private buf: LogRecord[] = [];

  constructor(max: number) {
    this.max = Math.max(1, max);
  }

  push(r: LogRecord): void {
    this.buf.push(r);
    if (this.buf.length > this.max) {
      this.buf = this.buf.slice(this.buf.length - this.max);
    }
  }

  latest(max: number): ReadonlyArray<LogRecord> {
    const n = Math.max(0, max);
    if (n === 0) return [];
    if (this.buf.length <= n) return this.buf;
    return this.buf.slice(this.buf.length - n);
  }
}
