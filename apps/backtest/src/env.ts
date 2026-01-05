/**
 * Backtest Environment Configuration
 *
 * Requirements: 11.1-11.4
 * - Replay md_* data with fixed tick interval
 * - Simulated execution (touch fill)
 * - Output metrics and CSV
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
    EXCHANGE: z.string().default("extended"),
    SYMBOL: z.string(),
    START_TIME: z.coerce.date(),
    END_TIME: z.coerce.date(),
    /** Fixed tick interval in ms (11.2) */
    TICK_INTERVAL_MS: z.coerce.number().default(200),
    /** Output CSV file path for fills (11.4) */
    BACKTEST_OUT_CSV: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

export type Env = typeof env;
