/**
 * ESLint configuration for apps/server.
 * Enforces dependency direction rules to prevent architecture violations.
 */

import { nodeTypeCheckedConfig } from "@bun-hono-ddd-template/eslint-config/node";
import type { Linter } from "eslint";

/**
 * Dependency direction rules:
 * - routes -> usecases -> domain
 * - usecases -> interfaces (repository interfaces)
 * - repositories -> interfaces (+domain)
 * - domain must NOT import from routes/usecases/repositories
 */
const dependencyDirectionRules: Linter.Config = {
  files: ["src/domain/**/*.ts"],
  ignores: ["**/*.test.ts", "**/*.spec.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/routes/**", "**/routes"],
            message: "Domain layer must not import from routes layer.",
          },
          {
            group: ["**/usecases/**", "**/usecases"],
            message: "Domain layer must not import from usecases layer.",
          },
          {
            group: ["**/repositories/**", "**/repositories"],
            message: "Domain layer must not import from repositories layer.",
          },
        ],
      },
    ],
  },
};

/**
 * Routes should use usecases, not domain directly (soft rule).
 * This is enforced as a warning to allow exceptions when needed.
 */
const routesDomainRule: Linter.Config = {
  files: ["src/routes/**/*.ts"],
  ignores: ["**/*.test.ts", "**/*.spec.ts"],
  rules: {
    "no-restricted-imports": [
      "warn",
      {
        patterns: [
          {
            group: ["**/domain/*/services/**", "**/domain/*/value-objects/**"],
            message:
              "Routes should use usecases, not domain services/value-objects directly.",
          },
        ],
      },
    ],
  },
};

/**
 * Usecases must not import from routes or repository implementations.
 * However, usecases CAN import from repositories/interfaces (repository interfaces).
 */
const usecasesDirectionRule: Linter.Config = {
  files: ["src/usecases/**/*.ts"],
  ignores: ["**/*.test.ts", "**/*.spec.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/routes/**", "**/routes"],
            message: "Usecases must not import from routes layer.",
          },
          {
            group: ["**/repositories/memory/**", "**/repositories/postgres/**"],
            message:
              "Usecases must not import from repository implementations (use interface).",
          },
        ],
      },
    ],
  },
};

const config: Linter.Config[] = [
  ...nodeTypeCheckedConfig,
  dependencyDirectionRules,
  routesDomainRule,
  usecasesDirectionRule,
];

export default config;
