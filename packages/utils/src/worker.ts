/**
 * Common worker pattern utilities
 *
 * Provides reusable interval-based worker execution with graceful shutdown.
 */

import { logger } from "./logger";

/**
 * Options for creating an interval-based worker
 */
export interface WorkerOptions {
  /**
   * Name of the worker (for logging)
   */
  name: string;

  /**
   * Interval in milliseconds between runs
   */
  intervalMs: number;

  /**
   * Function to run on each iteration
   */
  runOnce: () => Promise<void>;

  /**
   * Optional cleanup function to run on shutdown
   */
  cleanup?: () => Promise<void> | void;

  /**
   * Optional metadata to log on startup
   */
  startupMetadata?: Record<string, unknown>;
}

/**
 * Create and start an interval-based worker
 *
 * This function handles:
 * - Initial run
 * - Periodic execution via setInterval
 * - In-flight guard to prevent parallel execution
 * - Graceful shutdown on SIGINT/SIGTERM
 * - Error handling
 *
 * @param options - Worker configuration
 */
export function createIntervalWorker(options: WorkerOptions): void {
  const { name, intervalMs, runOnce, cleanup, startupMetadata } = options;

  logger.info(`Starting ${name}`, startupMetadata ?? {});

  // In-flight guard to prevent parallel execution
  let isRunning = false;
  // Shutdown guard to ensure cleanup runs once
  let isShuttingDown = false;

  const runWithGuard = async (): Promise<void> => {
    if (isRunning) {
      logger.debug(`${name} skipped - previous run still in progress`);
      return;
    }

    isRunning = true;
    try {
      await runOnce();
    } finally {
      isRunning = false;
    }
  };

  // Run immediately
  void runWithGuard().catch((error: unknown) => {
    logger.error(`${name} initial run failed`, { error });
  });

  // Run periodically
  const interval = setInterval(() => {
    void runWithGuard().catch((error: unknown) => {
      logger.error(`${name} iteration failed`, { error });
    });
  }, intervalMs);

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`Shutting down ${name}...`);
    clearInterval(interval);

    if (cleanup) {
      try {
        await cleanup();
      } catch (error: unknown) {
        logger.error(`${name} cleanup failed`, { error });
      }
    }

    logger.info(`${name} shutdown complete`);
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  logger.info(`${name} running`);
}
