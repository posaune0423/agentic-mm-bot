/**
 * Test helpers for Postgres integration tests.
 * Provides database setup and cleanup utilities.
 */

import type { Pool } from "pg";

import {
  createDb,
  createPool,
  type Database,
} from "../../src/repositories/postgres/db";
import { createPostgresPostRepository } from "../../src/repositories/postgres/post-repository";
import { createPostgresUserRepository } from "../../src/repositories/postgres/user-repository";

/**
 * Test database context with all repositories.
 */
export interface TestDbContext {
  readonly db: Database;
  readonly pool: Pool;
  readonly userRepository: ReturnType<typeof createPostgresUserRepository>;
  readonly postRepository: ReturnType<typeof createPostgresPostRepository>;
}

/**
 * Create a test database context.
 * Uses DATABASE_URL from environment or defaults to local docker-compose.
 */
export const createTestDbContext = (): TestDbContext => {
  const pool = createPool();
  const db = createDb({ pool });
  const userRepository = createPostgresUserRepository(db);
  const postRepository = createPostgresPostRepository(db);

  return { db, pool, userRepository, postRepository };
};

/**
 * Truncate all test tables to ensure isolation between tests.
 * Uses CASCADE to handle foreign key constraints.
 */
export const truncateTables = async (pool: Pool): Promise<void> => {
  await pool.query('TRUNCATE TABLE "post", "user" RESTART IDENTITY CASCADE');
};

/**
 * Close the database pool.
 * Call this in afterAll to clean up connections.
 */
export const closePool = async (pool: Pool): Promise<void> => {
  await pool.end();
};
