import { nodeConfig } from "@agentic-mm-bot/eslint-config";
import type { Linter } from "eslint";

const config: Linter.Config[] = [
  ...nodeConfig,
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
        project: ["./tsconfig.eslint.json"],
      },
    },
  },
  // Package-specific ignores
  {
    ignores: ["eslint.config.ts", "tests/**"],
  },
];

export default config;
