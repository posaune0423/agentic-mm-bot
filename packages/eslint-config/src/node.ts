import eslint from "@eslint/js";
import type { Linter } from "eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";
import { ignorePatterns, strictTypeScriptRules, testFileRules } from "./base";

/**
 * Node.js ESLint configuration (without type checking)
 *
 * Note: Prettier is run separately from ESLint to avoid conflicts with @prettier/plugin-oxc.
 * Use `bun run format:fix` to format code with prettier.
 */
export const nodeConfig: Linter.Config[] = [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.es2022,
        ...globals.node,
      },
    },
    rules: strictTypeScriptRules,
  },
  // Prettier config to disable conflicting rules (must be last to override other configs)
  prettier,
  {
    ignores: ignorePatterns,
  },
];

/**
 * Node.js ESLint configuration with type checking
 * Includes separate config for test files (without type checking)
 *
 * Note: Prettier is run separately from ESLint to avoid conflicts with @prettier/plugin-oxc.
 * Use `bun run format:fix` to format code with prettier.
 */
export const nodeTypeCheckedConfig: Linter.Config[] = [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  // Source files config (with type checking)
  {
    files: ["src/**/*.{js,mjs,cjs,ts,mts,cts}", "scripts/**/*.{js,mjs,cjs,ts,mts,cts}"],
    ...tseslint.configs.recommendedTypeChecked[0],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.es2022,
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      ...strictTypeScriptRules,
      "@typescript-eslint/no-deprecated": "error",
    },
  },
  // Config files (drizzle.config.ts, eslint.config.ts, etc.) - without type checking
  {
    files: ["*.config.ts", "*.config.js", "*.config.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.es2022,
        ...globals.node,
      },
    },
    rules: strictTypeScriptRules,
  },
  // Test files config (without type checking)
  {
    files: ["tests/**/*.{js,mjs,cjs,ts,mts,cts}", "**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.es2022,
        ...globals.node,
      },
    },
    rules: testFileRules,
  },
  // Prettier config to disable conflicting rules (must be last to override other configs)
  prettier,
  {
    ignores: ignorePatterns,
  },
];

export default nodeConfig;
