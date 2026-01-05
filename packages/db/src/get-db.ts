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

export function getDb(connectionString: string): Db {
  if (!connectionString) {
    throw new Error("DATABASE_URL is empty");
  }

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  return db;
}
