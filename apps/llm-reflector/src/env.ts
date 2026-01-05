/**
 * LLM Reflector Environment Configuration
 *
 * Requirements: 1.4, 10.1, 13.1
 * - Environment variables via Zod validation
 * - OpenAI API key for LLM integration
 * - LOG_DIR for reasoning log storage
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

    // LLM Configuration
    OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
    OPENAI_MODEL: z.string().default("gpt-4o"),

    // Log storage
    LOG_DIR: z.string().default("./logs"),

    // Scheduler
    RUN_INTERVAL_MS: z.coerce.number().default(3_600_000), // Run every hour
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

export type Env = typeof env;
