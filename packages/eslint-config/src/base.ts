import eslint from "@eslint/js";
import type { Linter } from "eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Common strict rules for TypeScript projects
 *
 * Note: Prettier is run separately from ESLint to avoid conflicts with @prettier/plugin-oxc.
 * Use `bun run format:fix` to format code with prettier.
 */
export const strictTypeScriptRules: Linter.RulesRecord = {
  // TypeScript specific rules
  "@typescript-eslint/no-unused-vars": [
    "error",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
    },
  ],
  "@typescript-eslint/consistent-type-imports": [
    "error",
    {
      prefer: "type-imports",
      fixStyle: "inline-type-imports",
    },
  ],
  "@typescript-eslint/no-import-type-side-effects": "error",
  "@typescript-eslint/no-explicit-any": "off",
  "@typescript-eslint/no-non-null-assertion": "off",
  "@typescript-eslint/explicit-module-boundary-types": "off",
  // Code quality rules
  "prefer-const": "error",
  "no-var": "error",
};

/**
 * Rules for test files (without type checking)
 */
export const testFileRules: Linter.RulesRecord = {
  ...strictTypeScriptRules,
  // Disable type-aware rules for test files
  "@typescript-eslint/no-unsafe-assignment": "off",
  "@typescript-eslint/no-unsafe-member-access": "off",
  "@typescript-eslint/no-unsafe-call": "off",
  "@typescript-eslint/no-unsafe-return": "off",
  "@typescript-eslint/no-floating-promises": "off",
  "@typescript-eslint/require-await": "off",
  "@typescript-eslint/await-thenable": "off",
  // Allow @ts-nocheck and require() in test files
  "@typescript-eslint/ban-ts-comment": "off",
  "@typescript-eslint/no-require-imports": "off",
};

/**
 * Common ignore patterns
 */
export const ignorePatterns: string[] = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.turbo/**",
  "**/.wxt/**",
  "**/.vocs/**",
  "**/.output/**",
  "**/.wrangler/**",
  "**/.cursor/**",
  "**/*.lock",
  "**/.env*",
  "**/*.log",
  "**/.DS_Store",
  "**/migrations/**",
  "**/*.json",
  "**/*.jsonc",
  "**/*.json5",
  "**/*.md",
  "**/*.mdx",
];

/**
 * Base ESLint configuration (without type checking)
 * Use this for projects that don't need type-aware rules
 */
export const baseConfig: Linter.Config[] = [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.es2022,
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
 * Type-checked base configuration
 * Use this for projects with proper tsconfig setup
 */
export const baseTypeCheckedConfig: Linter.Config[] = [
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.es2022,
      },
    },
    rules: {
      ...strictTypeScriptRules,
      "@typescript-eslint/no-deprecated": "error",
    },
  },
  // Prettier config to disable conflicting rules (must be last to override other configs)
  prettier,
  {
    ignores: ignorePatterns,
  },
];

export default baseConfig;
