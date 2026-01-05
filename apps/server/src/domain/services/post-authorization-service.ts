/**
 * Post Authorization Domain Service.
 *
 * Handles business logic related to post authorization and access control.
 * Determines whether a user has permission to perform actions on posts.
 */

import type { Result } from "neverthrow";
import { err, ok } from "neverthrow";

import type { NotFoundError, UnauthorizedError } from "../errors";

type RepoError = {
  readonly message: string;
};

type User = {
  readonly id: string;
  readonly deletedAt: Date | null;
};

type Post = {
  readonly id: string;
  readonly authorId: string;
  readonly deletedAt: Date | null;
};

type UserReader = {
  findById(id: string): Promise<Result<User | null, RepoError>>;
};

type PostReader = {
  findById(id: string): Promise<Result<Post | null, RepoError>>;
};

/**
 * Authorization check result.
 */
export interface AuthorizationResult {
  readonly isAuthorized: boolean;
  readonly reason?: string;
}

/**
 * Error types for authorization service.
 */
export type AuthorizationServiceError = NotFoundError | UnauthorizedError;

/**
 * Post Authorization Service interface.
 * Encapsulates authorization-related business logic.
 */
export interface PostAuthorizationService {
  /**
   * Check if user can edit a post.
   * Only the author can edit their own posts.
   */
  canEditPost(
    userId: string,
    postId: string,
  ): Promise<Result<AuthorizationResult, AuthorizationServiceError>>;

  /**
   * Check if user can delete a post.
   * Only the author can delete their own posts.
   */
  canDeletePost(
    userId: string,
    postId: string,
  ): Promise<Result<AuthorizationResult, AuthorizationServiceError>>;

  /**
   * Check if user can view a post.
   * All users can view non-deleted posts.
   */
  canViewPost(
    postId: string,
  ): Promise<Result<AuthorizationResult, AuthorizationServiceError>>;
}

/**
 * Dependencies for creating PostAuthorizationService.
 */
export interface CreatePostAuthorizationServiceDeps {
  readonly postRepository: PostReader;
  readonly userRepository: UserReader;
}

/**
 * Create PostAuthorizationService instance.
 */
export function createPostAuthorizationService(
  deps: CreatePostAuthorizationServiceDeps,
): PostAuthorizationService {
  const { postRepository, userRepository } = deps;

  /**
   * Helper to verify user exists and is not deleted.
   */
  async function verifyUserExists(
    userId: string,
  ): Promise<Result<User, AuthorizationServiceError>> {
    const userResult = await userRepository.findById(userId);
    if (userResult.isErr()) {
      return err({
        type: "UnauthorizedError",
        message: `Failed to verify user: ${userResult.error.message}`,
      });
    }

    const user = userResult.value;
    if (!user || user.deletedAt !== null) {
      return err({
        type: "UnauthorizedError",
        message: "User not found or deleted",
      });
    }

    return ok(user);
  }

  /**
   * Helper to verify post exists and is not deleted.
   */
  async function verifyPostExists(
    postId: string,
  ): Promise<Result<Post, AuthorizationServiceError>> {
    const postResult = await postRepository.findById(postId);
    if (postResult.isErr()) {
      return err({
        type: "NotFoundError",
        message: `Failed to find post: ${postResult.error.message}`,
        resource: "Post",
        id: postId,
      });
    }

    const post = postResult.value;
    if (!post || post.deletedAt !== null) {
      return err({
        type: "NotFoundError",
        message: "Post not found or deleted",
        resource: "Post",
        id: postId,
      });
    }

    return ok(post);
  }

  return {
    async canEditPost(userId, postId) {
      // Verify user exists
      const userResult = await verifyUserExists(userId);
      if (userResult.isErr()) {
        return err(userResult.error);
      }

      // Verify post exists
      const postResult = await verifyPostExists(postId);
      if (postResult.isErr()) {
        return err(postResult.error);
      }

      const post = postResult.value;

      // Check if user is the author
      if (post.authorId !== userId) {
        return ok({
          isAuthorized: false,
          reason: "Only the author can edit this post",
        });
      }

      return ok({ isAuthorized: true });
    },

    async canDeletePost(userId, postId) {
      // Verify user exists
      const userResult = await verifyUserExists(userId);
      if (userResult.isErr()) {
        return err(userResult.error);
      }

      // Verify post exists
      const postResult = await verifyPostExists(postId);
      if (postResult.isErr()) {
        return err(postResult.error);
      }

      const post = postResult.value;

      // Check if user is the author
      if (post.authorId !== userId) {
        return ok({
          isAuthorized: false,
          reason: "Only the author can delete this post",
        });
      }

      return ok({ isAuthorized: true });
    },

    async canViewPost(postId) {
      // Verify post exists
      const postResult = await verifyPostExists(postId);
      if (postResult.isErr()) {
        return err(postResult.error);
      }

      // All users can view non-deleted posts
      return ok({ isAuthorized: true });
    },
  };
}
