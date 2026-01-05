import { nodeConfig } from "@agentic-mm-bot/eslint-config/node";
import type { Linter } from "eslint";

const config: Linter.Config[] = [
  ...nodeConfig,
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
        project: true,
      },
    },
  },
  // Package-specific ignores
  {
    ignores: ["dist/**", "eslint.config.ts", "tsdown.config.ts", "drizzle.config.ts", "tests/**"],
  },
];

export default config;
