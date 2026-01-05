/**
 * Route aggregation - all routes are registered here.
 */

import { Hono } from "hono";

import { createPostAuthorizationService } from "../domain/services/post-authorization-service";
import { createUserAuthenticationService } from "../domain/services/user-authentication-service";
import type { PostRepository } from "../repositories/interfaces/post-repository";
import type { UserRepository } from "../repositories/interfaces/user-repository";
import { health } from "./health";
import { createPostRoutes } from "./posts";
import { createUserRoutes } from "./users";

/**
 * Dependencies for all routes.
 * All external dependencies are injected here for testability.
 */
export interface RoutesDeps {
  readonly userRepository: UserRepository;
  readonly postRepository: PostRepository;
}

/**
 * Create all routes with injected dependencies.
 */
export const createRoutes = (deps?: Partial<RoutesDeps>) => {
  const routes = new Hono();

  routes.route("/health", health);

  // Mount user routes if repository is provided
  if (deps?.userRepository) {
    // Instantiate domain services
    const userAuthenticationService = createUserAuthenticationService({
      userRepository: deps.userRepository,
    });

    const userRoutes = createUserRoutes({
      userRepository: deps.userRepository,
      userAuthenticationService,
    });
    routes.route("/users", userRoutes);
  }

  // Mount post routes if both repositories are provided
  if (deps?.postRepository && deps?.userRepository) {
    // Instantiate domain services
    const postAuthorizationService = createPostAuthorizationService({
      postRepository: deps.postRepository,
      userRepository: deps.userRepository,
    });

    const postRoutes = createPostRoutes({
      postRepository: deps.postRepository,
      userRepository: deps.userRepository,
      postAuthorizationService,
    });
    routes.route("/posts", postRoutes);
  }

  return routes;
};

export { createPostRoutes, createUserRoutes, health };
