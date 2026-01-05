/**
 * Backtest Environment Configuration
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
    TICK_INTERVAL_MS: z.coerce.number().default(200),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
export type Env = typeof env;
