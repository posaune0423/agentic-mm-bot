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
 * - Graceful shutdown on SIGINT/SIGTERM
 * - Error handling
 *
 * @param options - Worker configuration
 */
export function createIntervalWorker(options: WorkerOptions): void {
  const { name, intervalMs, runOnce, cleanup, startupMetadata } = options;

  logger.info(`Starting ${name}`, startupMetadata ?? {});

  // Track running promise to wait for completion during shutdown
  let runningPromise: Promise<void> | null = null;

  const runOnceSafely = async (): Promise<void> => {
    runningPromise = runOnce().catch((error: unknown) => {
      logger.error(`${name} iteration failed`, { error });
    });
    await runningPromise;
    runningPromise = null;
  };

  // Run immediately
  void runOnceSafely();

  // Run periodically
  const interval = setInterval(() => {
    void runOnceSafely();
  }, intervalMs);

  // Graceful shutdown
  let isShuttingDown = false;
  const shutdown = async (): Promise<void> => {
    // Prevent multiple shutdown calls
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    logger.info(`Shutting down ${name}...`);
    clearInterval(interval);

    // Wait for any running iteration to complete (with timeout)
    if (runningPromise) {
      try {
        await Promise.race([
          runningPromise,
          new Promise<void>((resolve) => {
            setTimeout(() => {
              resolve();
            }, 5000); // 5 second timeout
          }),
        ]);
      } catch (error) {
        logger.warn(`${name} running iteration error during shutdown`, {
          error,
        });
      }
    }

    if (cleanup) {
      await cleanup();
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
