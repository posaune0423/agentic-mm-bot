/**
 * Executor Environment Configuration
 *
 * Requirements: 1.4
 * - Type-safe environment variables with Zod validation
 */

import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * - t3-env (@t3-oss/env-core) による型安全な環境変数
 * - `process.env` を直接参照せず、この `env` もしくは `loadEnv()` を使う
 */

const envResult = createEnv({
  server: {
    // Database
    DATABASE_URL: z.url(),

    // Logging
    LOG_LEVEL: z.enum(["ERROR", "WARN", "LOG", "INFO", "DEBUG"]).default("INFO"),
    LOG_DIR: z.string().default("./logs"),

    // Application
    APP_ENV: z.enum(["development", "test", "production"]).default("development"),

    // Trading
    EXCHANGE: z.string().default("extended"),
    SYMBOL: z.string(),

    // Extended Exchange
    EXTENDED_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
    EXTENDED_API_KEY: z.string(),
    EXTENDED_STARK_PRIVATE_KEY: z.string(),
    EXTENDED_STARK_PUBLIC_KEY: z.string(),
    EXTENDED_VAULT_ID: z.coerce.number(),

    // Executor Configuration
    TICK_INTERVAL_MS: z.coerce.number().default(200),
    STATE_PERSIST_INTERVAL_MS: z.coerce.number().default(10_000),
    EVENT_FLUSH_INTERVAL_MS: z.coerce.number().default(1_000),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

export type Env = {
  DATABASE_URL: string;
  LOG_LEVEL: "ERROR" | "WARN" | "LOG" | "INFO" | "DEBUG";
  LOG_DIR: string;
  APP_ENV: "development" | "test" | "production";
  EXCHANGE: string;
  SYMBOL: string;
  EXTENDED_NETWORK: "testnet" | "mainnet";
  EXTENDED_API_KEY: string;
  EXTENDED_STARK_PRIVATE_KEY: string;
  EXTENDED_STARK_PUBLIC_KEY: string;
  EXTENDED_VAULT_ID: number;
  TICK_INTERVAL_MS: number;
  STATE_PERSIST_INTERVAL_MS: number;
  EVENT_FLUSH_INTERVAL_MS: number;
};

export const env: Env = envResult;

export function loadEnv(): Env {
  return env;
}
