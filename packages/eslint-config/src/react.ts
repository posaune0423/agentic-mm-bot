import eslint from "@eslint/js";
import type { Linter } from "eslint";
// @ts-expect-error - eslint-config-prettier has no type declarations
import prettier from "eslint-config-prettier";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import { ignorePatterns, strictTypeScriptRules, testFileRules } from "./base";

/**
 * React ESLint configuration (without type checking)
 *
 * Note: Prettier is run separately from ESLint to avoid conflicts with @prettier/plugin-oxc.
 * Use `bun run format:fix` to format code with prettier.
 */
export const reactConfig: Linter.Config[] = [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.es2022,
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      ...strictTypeScriptRules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      "react-hooks/exhaustive-deps": "off",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
    },
  },
  // Prettier config to disable conflicting rules (must be last to override other configs)
  prettier,
  {
    ignores: ignorePatterns,
  },
];

/**
 * React ESLint configuration with type checking
 * Includes separate config for test files (without type checking)
 *
 * Note: Prettier is run separately from ESLint to avoid conflicts with @prettier/plugin-oxc.
 * Use `bun run format:fix` to format code with prettier.
 */
export const reactTypeCheckedConfig: Linter.Config[] = [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  // Source files config (with type checking)
  {
    files: ["src/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}", "docs/**/*.{ts,tsx,mdx}"],
    ...tseslint.configs.recommendedTypeChecked[0],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.es2022,
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        projectService: true,
      },
    },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      ...strictTypeScriptRules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      "react-hooks/exhaustive-deps": "off",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
    },
  },
  // Config files (vocs.config.ts, eslint.config.ts, etc.) - without type checking
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
    files: ["tests/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}", "**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.es2022,
        ...globals.browser,
      },
    },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      ...testFileRules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      "react-hooks/exhaustive-deps": "off",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
    },
  },
  // Prettier config to disable conflicting rules (must be last to override other configs)
  prettier,
  {
    ignores: ignorePatterns,
  },
];

export default reactConfig;
