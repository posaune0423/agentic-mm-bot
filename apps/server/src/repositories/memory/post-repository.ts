/**
 * In-Memory Post Repository implementation.
 * Used for testing without database dependencies.
 */

import { type Result, err, ok } from "neverthrow";

import { notFoundError } from "../../domain/errors";
import type {
  CreatePostInput,
  FindAllPostsOptions,
  FindAllPostsResult,
  Post,
  PostRepository,
  PostRepositoryError,
  UpdatePostInput,
} from "../interfaces/post-repository";

/**
 * Create an in-memory Post Repository.
 * Data is stored in a Map and cleared when the repository is recreated.
 *
 * @returns PostRepository implementation
 */
export const createInMemoryPostRepository = (): PostRepository & {
  clear: () => void;
} => {
  const posts = new Map<string, Post>();

  return {
    async findById(
      id: string,
    ): Promise<Result<Post | null, PostRepositoryError>> {
      const post = posts.get(id);

      if (post?.deletedAt) {
        return ok(null);
      }

      return ok(post ?? null);
    },

    async findAll(
      options: FindAllPostsOptions,
    ): Promise<Result<FindAllPostsResult, PostRepositoryError>> {
      let activePosts = Array.from(posts.values()).filter(
        (post) => !post.deletedAt,
      );

      // Filter by authorId if provided
      if (options.authorId) {
        activePosts = activePosts.filter(
          (post) => post.authorId === options.authorId,
        );
      }

      const total = activePosts.length;
      const sliced = activePosts.slice(
        options.offset,
        options.offset + options.limit,
      );

      return ok({ posts: sliced, total });
    },

    async create(
      input: CreatePostInput,
    ): Promise<Result<Post, PostRepositoryError>> {
      const now = new Date();
      const newPost: Post = {
        id: crypto.randomUUID(),
        title: input.title,
        content: input.content,
        authorId: input.authorId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };

      posts.set(newPost.id, newPost);

      return ok(newPost);
    },

    async update(
      id: string,
      input: UpdatePostInput,
    ): Promise<Result<Post, PostRepositoryError>> {
      const existing = posts.get(id);

      if (!existing || existing.deletedAt) {
        return err(notFoundError("Post", id));
      }

      const updatedPost: Post = {
        ...existing,
        title: input.title ?? existing.title,
        content: input.content ?? existing.content,
        updatedAt: new Date(),
      };

      posts.set(id, updatedPost);

      return ok(updatedPost);
    },

    async delete(id: string): Promise<Result<void, PostRepositoryError>> {
      const existing = posts.get(id);

      if (!existing || existing.deletedAt) {
        return err(notFoundError("Post", id));
      }

      const deletedPost: Post = {
        ...existing,
        deletedAt: new Date(),
      };

      posts.set(id, deletedPost);

      return ok(undefined);
    },

    /**
     * Clear all posts from the repository.
     * Useful for test cleanup.
     */
    clear(): void {
      posts.clear();
    },
  };
};
