/**
 * Backtest Environment Configuration
 */

import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * - t3-env (@t3-oss/env-core) による型安全な環境変数
 * - `process.env` を直接参照せず、この `env` もしくは `loadEnv()` を使う
 */

const envResult = createEnv({
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

export type Env = {
  DATABASE_URL: string;
  LOG_LEVEL: "ERROR" | "WARN" | "LOG" | "INFO" | "DEBUG";
  EXCHANGE: string;
  SYMBOL: string;
  START_TIME: Date;
  END_TIME: Date;
  TICK_INTERVAL_MS: number;
};

export const env: Env = envResult;

export function loadEnv(): Env {
  return env;
}
