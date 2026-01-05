import { nodeConfig } from "@bun-hono-ddd-template/eslint-config/node";
import type { Linter } from "eslint";

const config: Linter.Config[] = [
  ...nodeConfig,
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Package-specific ignores
  {
    ignores: ["dist/**"],
  },
];

export default config;
