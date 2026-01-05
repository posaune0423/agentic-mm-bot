/**
 * Create Post UseCase unit tests.
 * Tests business logic with in-memory repositories.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { User } from "../../../src/repositories/interfaces/user-repository";
import { executeCreatePost } from "../../../src/usecases/create-post/usecase";
import {
  clearTestContext,
  createInMemoryTestContext,
  type InMemoryTestContext,
} from "../../helpers/memory";

describe("executeCreatePost", () => {
  let ctx: InMemoryTestContext;
  let testUser: User;

  beforeEach(async () => {
    ctx = createInMemoryTestContext();

    // Create a test user for posts
    const userResult = await ctx.userRepository.create({
      name: "Test Author",
      email: "author@example.com",
    });

    if (userResult.isErr()) {
      throw new Error("Failed to create test user");
    }

    testUser = userResult.value;
  });

  afterEach(() => {
    clearTestContext(ctx);
  });

  describe("successful creation", () => {
    it("should create a post with valid input", async () => {
      const result = await executeCreatePost(
        {
          postRepository: ctx.postRepository,
          userRepository: ctx.userRepository,
        },
        {
          title: "Test Post",
          content: "This is test content.",
          authorId: testUser.id,
        },
      );

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        expect(result.value.post.title).toBe("Test Post");
        expect(result.value.post.content).toBe("This is test content.");
        expect(result.value.post.authorId).toBe(testUser.id);
        expect(result.value.post.id).toBeDefined();
        expect(result.value.post.createdAt).toBeInstanceOf(Date);
      }
    });

    it("should create multiple posts for the same author", async () => {
      const result1 = await executeCreatePost(
        {
          postRepository: ctx.postRepository,
          userRepository: ctx.userRepository,
        },
        {
          title: "First Post",
          content: "First content.",
          authorId: testUser.id,
        },
      );

      const result2 = await executeCreatePost(
        {
          postRepository: ctx.postRepository,
          userRepository: ctx.userRepository,
        },
        {
          title: "Second Post",
          content: "Second content.",
          authorId: testUser.id,
        },
      );

      expect(result1.isOk()).toBe(true);
      expect(result2.isOk()).toBe(true);

      if (result1.isOk() && result2.isOk()) {
        expect(result1.value.post.id).not.toBe(result2.value.post.id);
      }
    });
  });

  describe("not found errors", () => {
    it("should return NotFoundError when author does not exist", async () => {
      const result = await executeCreatePost(
        {
          postRepository: ctx.postRepository,
          userRepository: ctx.userRepository,
        },
        {
          title: "Orphan Post",
          content: "Content without author.",
          authorId: "non-existent-user-id",
        },
      );

      expect(result.isErr()).toBe(true);

      if (result.isErr()) {
        expect(result.error.type).toBe("NotFoundError");
        expect(result.error.message).toContain("User");
      }
    });

    it("should return NotFoundError when author id is empty", async () => {
      const result = await executeCreatePost(
        {
          postRepository: ctx.postRepository,
          userRepository: ctx.userRepository,
        },
        { title: "Post", content: "Content.", authorId: "" },
      );

      expect(result.isErr()).toBe(true);

      if (result.isErr()) {
        expect(result.error.type).toBe("NotFoundError");
      }
    });
  });

  describe("post persistence", () => {
    it("should persist the created post", async () => {
      const createResult = await executeCreatePost(
        {
          postRepository: ctx.postRepository,
          userRepository: ctx.userRepository,
        },
        {
          title: "Persisted Post",
          content: "This should be saved.",
          authorId: testUser.id,
        },
      );

      expect(createResult.isOk()).toBe(true);

      if (createResult.isOk()) {
        const findResult = await ctx.postRepository.findById(
          createResult.value.post.id,
        );

        expect(findResult.isOk()).toBe(true);

        if (findResult.isOk()) {
          expect(findResult.value).not.toBeNull();
          expect(findResult.value?.title).toBe("Persisted Post");
        }
      }
    });
  });
});
