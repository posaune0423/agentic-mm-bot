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
 * - `process.env` を直接参照せず、この `env` を import して使う
 */

export const env = createEnv({
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

    // Strategy params refresh + LLM proposal apply cadence
    PARAMS_REFRESH_ENABLED: z.coerce.boolean().default(true),
    PARAMS_REFRESH_INTERVAL_MS: z.coerce.number().default(5_000),

    PROPOSAL_APPLY_ENABLED: z.coerce.boolean().default(true),
    PROPOSAL_APPLY_POLL_INTERVAL_MS: z.coerce.number().default(1_000),
    PROPOSAL_APPLY_BOUNDARY_MINUTES: z.coerce.number().default(1),
    PROPOSAL_APPLY_BOUNDARY_GRACE_SECONDS: z.coerce.number().default(30),
    PROPOSAL_APPLY_DATA_STALE_MS: z.coerce.number().default(10_000),
    PROPOSAL_APPLY_MAX_PAUSE_COUNT_LAST_HOUR: z.coerce.number().default(20),
    // If markout P50 is below this, reject proposals. Set very low (e.g. -1e9) to effectively disable.
    PROPOSAL_APPLY_MIN_MARKOUT10S_P50_BPS: z.coerce.number().default(-1e9),

    // CLI dashboard (TTY UI)
    EXECUTOR_DASHBOARD: z.coerce.boolean().default(true),
    EXECUTOR_DASHBOARD_REFRESH_MS: z.coerce.number().default(250),
    EXECUTOR_DASHBOARD_NO_COLOR: z.coerce.boolean().default(false),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
export type Env = typeof env;
