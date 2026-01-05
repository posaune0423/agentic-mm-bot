/**
 * Database connection factory with dependency injection support.
 * Allows injecting custom pool/URL for testing.
 */

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import * as schema from "@bun-hono-ddd-template/db";
import { env } from "../../env";

/**
 * Database type with schema inference.
 */
export type Database = NodePgDatabase<typeof schema>;

/**
 * Options for creating a database connection.
 * Arguments take priority over environment variables.
 */
export interface CreateDbOptions {
  /** Database connection URL (overrides DATABASE_URL env) */
  readonly databaseUrl?: string;
  /** Pre-configured pg Pool instance (takes highest priority) */
  readonly pool?: Pool;
  /** Additional pool configuration options */
  readonly poolConfig?: PoolConfig;
}

/**
 * Create a database connection with optional dependency injection.
 *
 * Priority:
 * 1. options.pool (if provided)
 * 2. options.databaseUrl
 * 3. DATABASE_URL env variable (validated by env module)
 *
 * @param options - Connection options
 * @returns Drizzle database instance
 */
export const createDb = (options?: CreateDbOptions): Database => {
  // Use provided pool if available
  if (options?.pool) {
    return drizzle(options.pool, { schema });
  }

  // Determine connection URL (options.databaseUrl takes priority over env)
  const connectionUrl = options?.databaseUrl ?? env.DATABASE_URL;

  // Create pool with optional config
  const pool = new Pool({
    connectionString: connectionUrl,
    ...options?.poolConfig,
  });

  return drizzle(pool, { schema });
};

/**
 * Create a pool for direct access (useful for cleanup in tests).
 */
export const createPool = (options?: CreateDbOptions): Pool => {
  if (options?.pool) {
    return options.pool;
  }

  const connectionUrl = options?.databaseUrl ?? env.DATABASE_URL;

  return new Pool({
    connectionString: connectionUrl,
    ...options?.poolConfig,
  });
};
