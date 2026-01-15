/**
 * Test helpers shared across apps/packages.
 *
 * Note: This file is intended for test code usage (bun:test).
 */

export function withPatchedStdout<T>(fn: (writes: string[]) => T): T {
  const writes: string[] = [];

  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

  Object.defineProperty(process.stdout, "isTTY", {
    value: true,
    configurable: true,
  });
  process.stdout.write = ((chunk: unknown) => {
    writes.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    return fn(writes);
  } finally {
    process.stdout.write = originalWrite;
    if (originalIsTTY) {
      Object.defineProperty(process.stdout, "isTTY", originalIsTTY);
    } else {
      delete (process.stdout as unknown as { isTTY?: unknown }).isTTY;
    }
  }
}

export function withPatchedIntervals<T>(fn: () => T): T {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;

  // Prevent background rendering in tests.
  globalThis.setInterval = ((handler: unknown, timeout?: number) => {
    void handler;
    void timeout;
    return 1 as unknown as ReturnType<typeof setInterval>;
  }) as unknown as typeof setInterval;

  globalThis.clearInterval = ((id: ReturnType<typeof setInterval>) => {
    void id;
  }) as typeof clearInterval;

  try {
    return fn();
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
}
