/**
 * LLM Reflector Environment Configuration
 *
 * Requirements: 1.4, 10.1, 13.1
 * - Environment variables via Zod validation
 * - OpenAI API key for LLM integration
 * - LOG_DIR for reasoning log storage
 */

import { z } from "zod";

const EnvSchema = z.object({
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
  RUN_INTERVAL_MS: z.coerce.number().default(3600_000), // Run every hour
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues.map(issue => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");

    throw new Error(`❌ Environment validation failed:\n${issues}`);
  }

  return result.data;
}
