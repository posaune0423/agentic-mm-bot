/**
 * Post Repository interface (Domain Port-like contract kept in repositories layer).
 * Defines the contract for post persistence.
 * Implementations are in repositories/postgres, repositories/memory, etc.
 */

import type { Result } from "neverthrow";

import type { NotFoundError, UnexpectedError } from "../../domain/errors";

/**
 * Post entity shape (for repository operations).
 */
export interface Post {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly authorId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

/**
 * Input for creating a new post.
 */
export interface CreatePostInput {
  readonly title: string;
  readonly content: string;
  readonly authorId: string;
}

/**
 * Input for updating a post.
 * All fields are optional for partial updates.
 */
export interface UpdatePostInput {
  readonly title?: string;
  readonly content?: string;
}

/**
 * Options for listing posts.
 */
export interface FindAllPostsOptions {
  readonly limit: number;
  readonly offset: number;
  readonly authorId?: string;
}

/**
 * Result of listing posts with pagination info.
 */
export interface FindAllPostsResult {
  readonly posts: readonly Post[];
  readonly total: number;
}

/**
 * Repository error types.
 */
export type PostRepositoryError = NotFoundError | UnexpectedError;

/**
 * Post Repository interface.
 * All methods return Result for consistent error handling.
 */
export interface PostRepository {
  /**
   * Find post by ID.
   * Returns null if not found (not an error).
   */
  findById(id: string): Promise<Result<Post | null, PostRepositoryError>>;

  /**
   * Find all posts with pagination.
   * Excludes soft-deleted posts.
   * Optionally filter by authorId.
   */
  findAll(
    options: FindAllPostsOptions,
  ): Promise<Result<FindAllPostsResult, PostRepositoryError>>;

  /**
   * Create a new post.
   */
  create(input: CreatePostInput): Promise<Result<Post, PostRepositoryError>>;

  /**
   * Update an existing post.
   * Returns NotFoundError if post does not exist.
   */
  update(
    id: string,
    input: UpdatePostInput,
  ): Promise<Result<Post, PostRepositoryError>>;

  /**
   * Soft delete a post by setting deletedAt.
   * Returns NotFoundError if post does not exist.
   */
  delete(id: string): Promise<Result<void, PostRepositoryError>>;
}
