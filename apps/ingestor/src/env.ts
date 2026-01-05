/**
 * Ingestor Environment Configuration
 */

import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * - t3-env (@t3-oss/env-core) による型安全な環境変数
 * - `process.env` を直接参照せず、この `env` を import して使う
 */
export const env = createEnv({
  server: {
    // Database
    DATABASE_URL: z.url(),

    // Logging
    LOG_LEVEL: z
      .enum(["ERROR", "WARN", "LOG", "INFO", "DEBUG"])
      .default("INFO"),

    // Application
    APP_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),

    // Trading
    EXCHANGE: z.string().default("extended"),
    SYMBOL: z.string(),

    // Extended Exchange
    EXTENDED_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
    EXTENDED_API_KEY: z.string(),
    EXTENDED_STARK_PRIVATE_KEY: z.string(),
    EXTENDED_STARK_PUBLIC_KEY: z.string(),
    EXTENDED_VAULT_ID: z.coerce.number(),

    // Ingestor Configuration
    BBO_THROTTLE_MS: z.coerce.number().default(100), // Throttle BBO writes (min interval ms)
    BBO_MIN_CHANGE_BPS: z.coerce.number().default(1), // Min mid change to write (bps)
    LATEST_TOP_UPSERT_INTERVAL_MS: z.coerce.number().default(1000), // latest_top upsert interval
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

export type Env = typeof env;
