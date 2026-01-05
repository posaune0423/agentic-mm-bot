/**
 * LLM Reflector Environment Configuration
 *
 * Requirements: 1.4, 10.1, 13.1
 * - Environment variables via Zod validation
 * - MODEL for Mastra model router (pluggable LLM provider)
 * - LOG_DIR for reasoning log storage
 */

import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.url(),
  LOG_LEVEL: z.enum(["ERROR", "WARN", "LOG", "INFO", "DEBUG"]).default("INFO"),
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  EXCHANGE: z.string().default("extended"),
  SYMBOL: z.string().default("BTC-USD"),

  // LLM Configuration (Mastra model router format)
  // Format: "provider/model" e.g., "openai/gpt-4o", "anthropic/claude-3-opus"
  MODEL: z.string().default("openai/gpt-4o"),

  // Provider API keys (Mastra auto-detects from env)
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  // Log storage
  LOG_DIR: z.string().default("./logs"),

  // Scheduler
  RUN_INTERVAL_MS: z.coerce.number().default(60_000), // Check every minute
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(`❌ Environment validation failed:\n${issues}`);
  }

  // Validate that at least one API key is present based on MODEL
  const env = result.data;
  const provider = env.MODEL.split("/")[0];

  if (provider === "openai" && !env.OPENAI_API_KEY) {
    throw new Error("❌ OPENAI_API_KEY is required when using openai models");
  }

  if (provider === "anthropic" && !env.ANTHROPIC_API_KEY) {
    throw new Error(
      "❌ ANTHROPIC_API_KEY is required when using anthropic models",
    );
  }

  return env;
}
