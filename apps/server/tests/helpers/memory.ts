/**
 * In-memory test helpers.
 * Provides factory functions for creating in-memory repositories for testing.
 */

import { createPostAuthorizationService } from "../../src/domain/services/post-authorization-service";
import { createUserAuthenticationService } from "../../src/domain/services/user-authentication-service";
import type { PostAuthorizationService } from "../../src/domain/services/post-authorization-service";
import type { UserAuthenticationService } from "../../src/domain/services/user-authentication-service";
import {
  createInMemoryPostRepository,
  createInMemoryUserRepository,
} from "../../src/repositories/memory";
import type { PostRepository } from "../../src/repositories/interfaces/post-repository";
import type { UserRepository } from "../../src/repositories/interfaces/user-repository";

/**
 * Context for in-memory database tests.
 */
export interface InMemoryTestContext {
  readonly userRepository: UserRepository & { clear: () => void };
  readonly postRepository: PostRepository & { clear: () => void };
  readonly userAuthenticationService: UserAuthenticationService;
  readonly postAuthorizationService: PostAuthorizationService;
}

/**
 * Create a test context with in-memory repositories.
 * Each call creates a new isolated context.
 *
 * @returns InMemoryTestContext with fresh repositories
 */
export const createInMemoryTestContext = (): InMemoryTestContext => {
  const userRepository = createInMemoryUserRepository();
  const postRepository = createInMemoryPostRepository();

  // Create domain services
  const userAuthenticationService = createUserAuthenticationService({
    userRepository,
  });
  const postAuthorizationService = createPostAuthorizationService({
    userRepository,
    postRepository,
  });

  return {
    userRepository,
    postRepository,
    userAuthenticationService,
    postAuthorizationService,
  };
};

/**
 * Clear all data in the test context.
 * Call this in afterEach to reset state between tests.
 *
 * @param ctx - The test context to clear
 */
export const clearTestContext = (ctx: InMemoryTestContext): void => {
  ctx.userRepository.clear();
  ctx.postRepository.clear();
};
