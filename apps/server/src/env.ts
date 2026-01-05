/**
 * Type-safe environment variables validation using t3-env.
 * This module provides centralized environment variable management
 * with runtime validation and type safety.
 *
 * @see https://env.t3.gg/docs/introduction
 */

import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * Define and validate environment variables.
 * All environment variables should be accessed through this module
 * instead of using process.env directly.
 */
export const env = createEnv({
  /**
   * Server-side environment variables.
   * These are only available on the server and will never be exposed to the client.
   */
  server: {
    // Database
    DATABASE_URL: z
      .url()
      .default("postgres://postgres:postgres@localhost:5432/postgres")
      .describe("PostgreSQL connection URL"),

    // Server
    PORT: z.coerce
      .number()
      .int()
      .positive()
      .default(8787)
      .describe("Server port number"),

    // Node environment
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development")
      .describe("Node environment"),
  },

  /**
   * Client-side environment variables.
   * These will be exposed to the client (if applicable in the future).
   */
  client: {},

  /**
   * Client prefix for client-side environment variables.
   * Required by t3-env even if we don't have client variables yet.
   */
  clientPrefix: "PUBLIC_",

  /**
   * Runtime environment variables.
   * This is where the actual values come from.
   */
  runtimeEnv: process.env,

  /**
   * Skip validation during build time.
   * Set to true if you want to skip validation (not recommended).
   */
  skipValidation: false,

  /**
   * Extend the zodError to provide more information.
   */
  onValidationError: (error) => {
    console.error("❌ Invalid environment variables:");
    for (const issue of error) {
      const path = issue.path?.join(".") ?? "unknown";
      console.error(`  - ${path}: ${issue.message}`);
    }
    throw new Error("Invalid environment variables");
  },

  /**
   * Called when server variables are accessed on the client.
   */
  onInvalidAccess: (variable) => {
    throw new Error(
      `❌ Attempted to access server-side environment variable "${variable}" on the client`,
    );
  },

  /**
   * Whether to treat empty strings as undefined.
   * This is useful for optional environment variables.
   */
  emptyStringAsUndefined: true,
});
