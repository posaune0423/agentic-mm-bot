/**
 * Hono application assembly.
 * This is where routes are mounted and middleware is applied.
 * Dependencies can be injected for testability.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import type { PostRepository } from "./repositories/interfaces/post-repository";
import type { UserRepository } from "./repositories/interfaces/user-repository";
import { createRoutes } from "./routes";

/**
 * Application dependencies.
 * All external dependencies are injected here for testability.
 */
export interface AppDependencies {
  readonly userRepository?: UserRepository;
  readonly postRepository?: PostRepository;
}

/**
 * Create the Hono application with optional dependency injection.
 * Use this in tests to inject fakes/mocks.
 */
export const createApp = (deps?: Partial<AppDependencies>) => {
  const app = new Hono();

  // Middleware
  app.use("*", logger());
  app.use("*", cors());

  // Mount routes with dependencies
  const routes = createRoutes({
    userRepository: deps?.userRepository,
    postRepository: deps?.postRepository,
  });
  app.route("/", routes);

  return app;
};

// Default app instance for production (no deps - routes requiring deps won't be mounted)
export const app = createApp();
