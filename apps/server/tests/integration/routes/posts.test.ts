/**
 * Post routes integration tests.
 * Tests HTTP layer with in-memory repositories.
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

describe("Post Routes Integration", () => {
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

  describe("CRUD Operations Flow", () => {
    it("should complete a full CRUD lifecycle", async () => {
      // CREATE
      const createResponse = await app.request("/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Test Post",
          content: "Test Content",
          authorId: testUser.id,
        }),
      });

      expect(createResponse.status).toBe(201);

      const createBody = (await createResponse.json()) as { data: Post };
      const postId = createBody.data.id;

      expect(postId).toBeDefined();

      // READ (single)
      const getResponse = await app.request(`/posts/${postId}`);

      expect(getResponse.status).toBe(200);

      const getBody = (await getResponse.json()) as { data: Post };

      expect(getBody.data.title).toBe("Test Post");
      expect(getBody.data.content).toBe("Test Content");
      expect(getBody.data.authorId).toBe(testUser.id);

      // READ (list)
      const listResponse = await app.request("/posts");

      expect(listResponse.status).toBe(200);

      const listBody = (await listResponse.json()) as {
        data: Post[];
        pagination: { total: number };
      };

      expect(listBody.data).toHaveLength(1);
      expect(listBody.pagination.total).toBe(1);

      // UPDATE (PUT)
      const putResponse = await app.request(`/posts/${postId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Updated Title",
          content: "Updated Content",
          userId: testUser.id,
        }),
      });

      expect(putResponse.status).toBe(200);

      const putBody = (await putResponse.json()) as { data: Post };

      expect(putBody.data.title).toBe("Updated Title");
      expect(putBody.data.content).toBe("Updated Content");

      // UPDATE (PATCH)
      const patchResponse = await app.request(`/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Patched Title",
          userId: testUser.id,
        }),
      });

      expect(patchResponse.status).toBe(200);

      const patchBody = (await patchResponse.json()) as { data: Post };

      expect(patchBody.data.title).toBe("Patched Title");
      expect(patchBody.data.content).toBe("Updated Content");

      // DELETE
      const deleteResponse = await app.request(`/posts/${postId}`, {
        method: "DELETE",
        headers: { "X-User-Id": testUser.id },
      });

      expect(deleteResponse.status).toBe(204);

      // Verify post is no longer accessible
      const getAfterDeleteResponse = await app.request(`/posts/${postId}`);

      expect(getAfterDeleteResponse.status).toBe(404);

      // Verify post is not in list
      const listAfterDeleteResponse = await app.request("/posts");
      const listAfterDeleteBody = (await listAfterDeleteResponse.json()) as {
        data: Post[];
        pagination: { total: number };
      };

      expect(listAfterDeleteBody.data).toHaveLength(0);
      expect(listAfterDeleteBody.pagination.total).toBe(0);
    });

    it("should filter posts by authorId", async () => {
      // Create a second user
      const secondUserResult = await ctx.userRepository.create({
        name: "Second Author",
        email: "second@example.com",
      });

      if (secondUserResult.isErr()) {
        throw new Error("Failed to create second user");
      }

      const secondUser = secondUserResult.value;

      // Create posts for first author
      await app.request("/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "First Author Post 1",
          content: "Content",
          authorId: testUser.id,
        }),
      });

      await app.request("/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "First Author Post 2",
          content: "Content",
          authorId: testUser.id,
        }),
      });

      // Create post for second author
      await app.request("/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Second Author Post",
          content: "Content",
          authorId: secondUser.id,
        }),
      });

      // Filter by first author
      const firstAuthorResponse = await app.request(
        `/posts?authorId=${testUser.id}`,
      );
      const firstAuthorBody = (await firstAuthorResponse.json()) as {
        data: Post[];
        pagination: { total: number };
      };

      expect(firstAuthorBody.data).toHaveLength(2);
      expect(firstAuthorBody.pagination.total).toBe(2);
      expect(
        firstAuthorBody.data.every((post) => post.authorId === testUser.id),
      ).toBe(true);

      // Filter by second author
      const secondAuthorResponse = await app.request(
        `/posts?authorId=${secondUser.id}`,
      );
      const secondAuthorBody = (await secondAuthorResponse.json()) as {
        data: Post[];
        pagination: { total: number };
      };

      expect(secondAuthorBody.data).toHaveLength(1);
      expect(secondAuthorBody.pagination.total).toBe(1);
      expect(secondAuthorBody.data[0]?.authorId).toBe(secondUser.id);
    });

    it("should handle pagination correctly with multiple posts", async () => {
      // Create 5 posts
      for (let i = 1; i <= 5; i++) {
        await app.request("/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `Post ${i}`,
            content: `Content ${i}`,
            authorId: testUser.id,
          }),
        });
      }

      // Get first page
      const page1Response = await app.request("/posts?limit=2&offset=0");
      const page1Body = (await page1Response.json()) as {
        data: Post[];
        pagination: { total: number; limit: number; offset: number };
      };

      expect(page1Body.data).toHaveLength(2);
      expect(page1Body.pagination.total).toBe(5);
      expect(page1Body.pagination.limit).toBe(2);
      expect(page1Body.pagination.offset).toBe(0);

      // Get second page
      const page2Response = await app.request("/posts?limit=2&offset=2");
      const page2Body = (await page2Response.json()) as {
        data: Post[];
        pagination: { total: number; limit: number; offset: number };
      };

      expect(page2Body.data).toHaveLength(2);
      expect(page2Body.pagination.offset).toBe(2);

      // Get third page
      const page3Response = await app.request("/posts?limit=2&offset=4");
      const page3Body = (await page3Response.json()) as {
        data: Post[];
        pagination: { total: number };
      };

      expect(page3Body.data).toHaveLength(1);
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
});
