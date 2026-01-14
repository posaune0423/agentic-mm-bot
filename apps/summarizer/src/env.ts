/**
 * Summarizer Environment Configuration
 */

import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * - t3-env (@t3-oss/env-core) による型安全な環境変数
 * - `process.env` を直接参照せず、この `env` を import して使う
 */
export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    LOG_LEVEL: z.enum(["ERROR", "WARN", "LOG", "INFO", "DEBUG"]).default("INFO"),
    APP_ENV: z.enum(["development", "test", "production"]).default("development"),
    EXCHANGE: z.string().default("extended"),
    SYMBOL: z.string().default("BTC-USD"),
    RUN_INTERVAL_MS: z.coerce.number().default(10_000), // Run every 10 seconds
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

export type Env = typeof env;
