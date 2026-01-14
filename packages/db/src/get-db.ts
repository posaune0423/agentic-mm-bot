/**
 * packages/db - DB connection helper
 *
 * 各 app で繰り返しがちな `Pool` / `drizzle` 初期化を 1 箇所に集約します。
 * `connectionString` だけ外から渡せば、schema も自動で紐づいた `db` を返します。
 *
 * 利用側は `@agentic-mm-bot/db/get-db` から import してください。
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

function normalizeConnectionString(connectionString: string): string {
  // In local dev, it's easy to end up with a stale DATABASE_URL (e.g. dev/dev)
  // while docker-compose defaults to postgres/postgres.
  // We keep prod strict and only apply the fallback in non-production envs.
  const appEnv = process.env.APP_ENV ?? process.env.NODE_ENV ?? "development";
  if (appEnv === "production") return connectionString;

  try {
    const url = new URL(connectionString);

    // If the app is configured to use dev/dev, try postgres/postgres instead.
    // This avoids "password authentication failed for user dev" when dev role
    // isn't present in the local container.
    if (url.username === "dev" && url.password === "dev") {
      url.username = "postgres";
      // Prefer explicit password if provided, otherwise default to "postgres"
      url.password = process.env.POSTGRES_PASSWORD ?? "postgres";
      return url.toString();
    }

    return connectionString;
  } catch {
    // If parsing fails, keep the original string and let pg report the error.
    return connectionString;
  }
}

export function getDb(connectionString: string): Db {
  if (!connectionString) {
    throw new Error("DATABASE_URL is empty");
  }

  const normalized = normalizeConnectionString(connectionString);
  const pool = new Pool({ connectionString: normalized });
  const db = drizzle(pool, { schema });

  return db;
}
