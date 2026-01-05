// Export schema and utilities (safe for client components)
export * from "./schema";

// Connection helper (Node-only)
export { getDb } from "./get-db";
export type { Db } from "./get-db";
export * from "./get-db";
