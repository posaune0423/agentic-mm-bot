/**
 * Postgres Post Repository implementation using Drizzle ORM.
 */

import { and, count, eq, isNull } from "drizzle-orm";
import { type Result, err, ok } from "neverthrow";

import { posts } from "@bun-hono-ddd-template/db";

import { notFoundError, unexpectedError } from "../../domain/errors";
import type {
  CreatePostInput,
  FindAllPostsOptions,
  FindAllPostsResult,
  Post,
  PostRepository,
  PostRepositoryError,
  UpdatePostInput,
} from "../interfaces/post-repository";
import type { Database } from "./db";

/**
 * Map database row to Post entity.
 */
const toPost = (row: typeof posts.$inferSelect): Post => ({
  id: row.id,
  title: row.title,
  content: row.content,
  authorId: row.authorId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt,
});

/**
 * Create a Postgres Post Repository.
 *
 * @param db - Drizzle database instance
 * @returns PostRepository implementation
 */
export const createPostgresPostRepository = (db: Database): PostRepository => ({
  async findById(
    id: string,
  ): Promise<Result<Post | null, PostRepositoryError>> {
    try {
      const result = await db
        .select()
        .from(posts)
        .where(and(eq(posts.id, id), isNull(posts.deletedAt)))
        .limit(1);

      return ok(result[0] ? toPost(result[0]) : null);
    } catch (error) {
      return err(unexpectedError("Failed to find post by id", error));
    }
  },

  async findAll(
    options: FindAllPostsOptions,
  ): Promise<Result<FindAllPostsResult, PostRepositoryError>> {
    try {
      // Build where conditions
      const conditions = [isNull(posts.deletedAt)];

      if (options.authorId) {
        conditions.push(eq(posts.authorId, options.authorId));
      }

      const whereClause = and(...conditions);

      const [postsResult, countResult] = await Promise.all([
        db
          .select()
          .from(posts)
          .where(whereClause)
          .limit(options.limit)
          .offset(options.offset),
        db.select({ count: count() }).from(posts).where(whereClause),
      ]);

      return ok({
        posts: postsResult.map(toPost),
        total: countResult[0]?.count ?? 0,
      });
    } catch (error) {
      return err(unexpectedError("Failed to find all posts", error));
    }
  },

  async create(
    input: CreatePostInput,
  ): Promise<Result<Post, PostRepositoryError>> {
    try {
      const result = await db
        .insert(posts)
        .values({
          title: input.title,
          content: input.content,
          authorId: input.authorId,
        })
        .returning();

      const created = result[0];

      if (!created) {
        return err(unexpectedError("Post creation returned no result"));
      }

      return ok(toPost(created));
    } catch (error) {
      return err(unexpectedError("Failed to create post", error));
    }
  },

  async update(
    id: string,
    input: UpdatePostInput,
  ): Promise<Result<Post, PostRepositoryError>> {
    try {
      // Build update object with only provided fields
      const updateData: Partial<typeof posts.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.title !== undefined) updateData.title = input.title;
      if (input.content !== undefined) updateData.content = input.content;

      const result = await db
        .update(posts)
        .set(updateData)
        .where(and(eq(posts.id, id), isNull(posts.deletedAt)))
        .returning();

      const updated = result[0];

      if (!updated) {
        return err(notFoundError("Post", id));
      }

      return ok(toPost(updated));
    } catch (error) {
      return err(unexpectedError("Failed to update post", error));
    }
  },

  async delete(id: string): Promise<Result<void, PostRepositoryError>> {
    try {
      const result = await db
        .update(posts)
        .set({ deletedAt: new Date() })
        .where(and(eq(posts.id, id), isNull(posts.deletedAt)))
        .returning({ id: posts.id });

      if (result.length === 0) {
        return err(notFoundError("Post", id));
      }

      return ok(undefined);
    } catch (error) {
      return err(unexpectedError("Failed to delete post", error));
    }
  },
});
