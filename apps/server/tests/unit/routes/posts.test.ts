/**
 * Post routes unit tests with in-memory repositories.
 * Tests HTTP layer without database dependencies.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createApp } from "../../../src/app";
import type { Post } from "../../../src/repositories/interfaces/post-repository";
import type { User } from "../../../src/repositories/interfaces/user-repository";
import {
  clearTestContext,
  createInMemoryTestContext,
  type InMemoryTestContext,
} from "../../helpers/memory";

describe("Post Routes", () => {
  let ctx: InMemoryTestContext;
  let app: ReturnType<typeof createApp>;
  let testUser: User;

  beforeEach(async () => {
    ctx = createInMemoryTestContext();
    app = createApp({
      userRepository: ctx.userRepository,
      postRepository: ctx.postRepository,
    });

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

  describe("GET /posts", () => {
    it("should return empty list when no posts exist", async () => {
      const response = await app.request("/posts");

      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        data: Post[];
        pagination: { total: number; limit: number; offset: number };
      };

      expect(body.data).toEqual([]);
      expect(body.pagination.total).toBe(0);
      expect(body.pagination.limit).toBe(20);
      expect(body.pagination.offset).toBe(0);
    });

    it("should return list of posts with pagination", async () => {
      await ctx.postRepository.create({
        title: "Post 1",
        content: "Content 1",
        authorId: testUser.id,
      });
      await ctx.postRepository.create({
        title: "Post 2",
        content: "Content 2",
        authorId: testUser.id,
      });
      await ctx.postRepository.create({
        title: "Post 3",
        content: "Content 3",
        authorId: testUser.id,
      });

      const response = await app.request("/posts?limit=2&offset=0");

      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        data: Post[];
        pagination: { total: number; limit: number; offset: number };
      };

      expect(body.data).toHaveLength(2);
      expect(body.pagination.total).toBe(3);
      expect(body.pagination.limit).toBe(2);
      expect(body.pagination.offset).toBe(0);
    });

    it("should filter posts by authorId", async () => {
      const secondUserResult = await ctx.userRepository.create({
        name: "Second Author",
        email: "second@example.com",
      });

      if (secondUserResult.isErr())
        throw new Error("Failed to create second user");

      const secondUser = secondUserResult.value;

      await ctx.postRepository.create({
        title: "Post 1",
        content: "Content 1",
        authorId: testUser.id,
      });
      await ctx.postRepository.create({
        title: "Post 2",
        content: "Content 2",
        authorId: secondUser.id,
      });
      await ctx.postRepository.create({
        title: "Post 3",
        content: "Content 3",
        authorId: testUser.id,
      });

      const response = await app.request(`/posts?authorId=${testUser.id}`);

      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        data: Post[];
        pagination: { total: number };
      };

      expect(body.data).toHaveLength(2);
      expect(body.pagination.total).toBe(2);
      expect(body.data.every((post) => post.authorId === testUser.id)).toBe(
        true,
      );
    });

    it("should handle offset correctly", async () => {
      await ctx.postRepository.create({
        title: "Post 1",
        content: "Content 1",
        authorId: testUser.id,
      });
      await ctx.postRepository.create({
        title: "Post 2",
        content: "Content 2",
        authorId: testUser.id,
      });
      await ctx.postRepository.create({
        title: "Post 3",
        content: "Content 3",
        authorId: testUser.id,
      });

      const response = await app.request("/posts?limit=10&offset=2");

      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        data: Post[];
        pagination: { total: number; limit: number; offset: number };
      };

      expect(body.data).toHaveLength(1);
      expect(body.pagination.offset).toBe(2);
    });

    it("should return 400 for invalid limit", async () => {
      const response = await app.request("/posts?limit=200");

      expect(response.status).toBe(400);
    });
  });

  describe("GET /posts/:id", () => {
    it("should return a post by ID", async () => {
      const createResult = await ctx.postRepository.create({
        title: "Test Post",
        content: "Test Content",
        authorId: testUser.id,
      });

      if (createResult.isErr()) throw new Error("Failed to create post");

      const post = createResult.value;
      const response = await app.request(`/posts/${post.id}`);

      expect(response.status).toBe(200);

      const body = (await response.json()) as { data: Post };

      expect(body.data.id).toBe(post.id);
      expect(body.data.title).toBe("Test Post");
      expect(body.data.content).toBe("Test Content");
      expect(body.data.authorId).toBe(testUser.id);
    });

    it("should return 404 for non-existent post", async () => {
      const response = await app.request("/posts/non-existent-id");

      expect(response.status).toBe(404);

      const body = (await response.json()) as { type: string };
      expect(body.type).toBe("urn:app:error:not-found");
    });

    it("should return 404 for deleted post", async () => {
      const createResult = await ctx.postRepository.create({
        title: "Test Post",
        content: "Test Content",
        authorId: testUser.id,
      });

      if (createResult.isErr()) throw new Error("Failed to create post");

      const post = createResult.value;
      await ctx.postRepository.delete(post.id);

      const response = await app.request(`/posts/${post.id}`);

      expect(response.status).toBe(404);
    });
  });

  describe("POST /posts", () => {
    it("should create a post and return 201", async () => {
      const response = await app.request("/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Test Post",
          content: "This is the content of the test post.",
          authorId: testUser.id,
        }),
      });

      expect(response.status).toBe(201);

      const body = (await response.json()) as {
        data: { id: string; title: string; content: string; authorId: string };
      };

      expect(body.data).toBeDefined();
      expect(body.data.id).toBeDefined();
      expect(body.data.title).toBe("Test Post");
      expect(body.data.content).toBe("This is the content of the test post.");
      expect(body.data.authorId).toBe(testUser.id);
    });

    it("should return 400 for missing title", async () => {
      const response = await app.request("/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "Content without title",
          authorId: testUser.id,
        }),
      });

      expect(response.status).toBe(400);

      const body = (await response.json()) as {
        type: string;
        errors: unknown[];
      };

      expect(body.type).toBe("urn:app:error:validation");
      expect(body.errors).toBeDefined();
    });

    it("should return 400 for missing content", async () => {
      const response = await app.request("/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Title without content",
          authorId: testUser.id,
        }),
      });

      expect(response.status).toBe(400);
    });

    it("should return 400 for missing authorId", async () => {
      const response = await app.request("/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Post Title",
          content: "Post content",
        }),
      });

      expect(response.status).toBe(400);
    });

    it("should return 404 for non-existent author", async () => {
      const response = await app.request("/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Post Title",
          content: "Post content",
          authorId: "non-existent-user-id",
        }),
      });

      expect(response.status).toBe(404);

      const body = (await response.json()) as { type: string };
      expect(body.type).toBe("urn:app:error:not-found");
    });
  });

  describe("PUT /posts/:id", () => {
    it("should fully update a post", async () => {
      const createResult = await ctx.postRepository.create({
        title: "Original Title",
        content: "Original Content",
        authorId: testUser.id,
      });

      if (createResult.isErr()) throw new Error("Failed to create post");

      const post = createResult.value;

      const response = await app.request(`/posts/${post.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Updated Title",
          content: "Updated Content",
          userId: testUser.id,
        }),
      });

      expect(response.status).toBe(200);

      const body = (await response.json()) as { data: Post };

      expect(body.data.title).toBe("Updated Title");
      expect(body.data.content).toBe("Updated Content");
    });

    it("should return 400 for missing required fields", async () => {
      const createResult = await ctx.postRepository.create({
        title: "Test Post",
        content: "Test Content",
        authorId: testUser.id,
      });

      if (createResult.isErr()) throw new Error("Failed to create post");

      const post = createResult.value;

      const response = await app.request(`/posts/${post.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Updated Title",
          // missing content
        }),
      });

      expect(response.status).toBe(400);
    });

    it("should return 404 for non-existent post", async () => {
      const response = await app.request("/posts/non-existent-id", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Updated Title",
          content: "Updated Content",
          userId: testUser.id,
        }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe("PATCH /posts/:id", () => {
    it("should partially update a post (title only)", async () => {
      const createResult = await ctx.postRepository.create({
        title: "Original Title",
        content: "Original Content",
        authorId: testUser.id,
      });

      if (createResult.isErr()) throw new Error("Failed to create post");

      const post = createResult.value;

      const response = await app.request(`/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Updated Title",
          userId: testUser.id,
        }),
      });

      expect(response.status).toBe(200);

      const body = (await response.json()) as { data: Post };

      expect(body.data.title).toBe("Updated Title");
      expect(body.data.content).toBe("Original Content");
    });

    it("should partially update a post (content only)", async () => {
      const createResult = await ctx.postRepository.create({
        title: "Original Title",
        content: "Original Content",
        authorId: testUser.id,
      });

      if (createResult.isErr()) throw new Error("Failed to create post");

      const post = createResult.value;

      const response = await app.request(`/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "Updated Content",
          userId: testUser.id,
        }),
      });

      expect(response.status).toBe(200);

      const body = (await response.json()) as { data: Post };

      expect(body.data.title).toBe("Original Title");
      expect(body.data.content).toBe("Updated Content");
    });

    it("should return 400 for empty update", async () => {
      const createResult = await ctx.postRepository.create({
        title: "Test Post",
        content: "Test Content",
        authorId: testUser.id,
      });

      if (createResult.isErr()) throw new Error("Failed to create post");

      const post = createResult.value;

      const response = await app.request(`/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
    });

    it("should return 404 for non-existent post", async () => {
      const response = await app.request("/posts/non-existent-id", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Updated Title",
          userId: testUser.id,
        }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /posts/:id", () => {
    it("should soft delete a post and return 204", async () => {
      const createResult = await ctx.postRepository.create({
        title: "Test Post",
        content: "Test Content",
        authorId: testUser.id,
      });

      if (createResult.isErr()) throw new Error("Failed to create post");

      const post = createResult.value;

      const response = await app.request(`/posts/${post.id}`, {
        method: "DELETE",
        headers: { "X-User-Id": testUser.id },
      });

      expect(response.status).toBe(204);

      // Verify post is no longer accessible
      const getResponse = await app.request(`/posts/${post.id}`);
      expect(getResponse.status).toBe(404);
    });

    it("should return 404 for non-existent post", async () => {
      const response = await app.request("/posts/non-existent-id", {
        method: "DELETE",
        headers: { "X-User-Id": testUser.id },
      });

      expect(response.status).toBe(404);
    });

    it("should return 404 for already deleted post", async () => {
      const createResult = await ctx.postRepository.create({
        title: "Test Post",
        content: "Test Content",
        authorId: testUser.id,
      });

      if (createResult.isErr()) throw new Error("Failed to create post");

      const post = createResult.value;

      // First delete
      await app.request(`/posts/${post.id}`, {
        method: "DELETE",
        headers: { "X-User-Id": testUser.id },
      });

      // Second delete should fail
      const response = await app.request(`/posts/${post.id}`, {
        method: "DELETE",
        headers: { "X-User-Id": testUser.id },
      });

      expect(response.status).toBe(404);
    });

    it("should not include deleted posts in list", async () => {
      const createResult = await ctx.postRepository.create({
        title: "Test Post",
        content: "Test Content",
        authorId: testUser.id,
      });

      if (createResult.isErr()) throw new Error("Failed to create post");

      const post = createResult.value;

      await app.request(`/posts/${post.id}`, {
        method: "DELETE",
        headers: { "X-User-Id": testUser.id },
      });

      const listResponse = await app.request("/posts");
      const body = (await listResponse.json()) as {
        data: Post[];
        pagination: { total: number };
      };

      expect(body.data).toHaveLength(0);
      expect(body.pagination.total).toBe(0);
    });
  });
});
