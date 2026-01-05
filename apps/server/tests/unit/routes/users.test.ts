/**
 * User routes unit tests with in-memory repositories.
 * Tests HTTP layer without database dependencies.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createApp } from "../../../src/app";
import type { User } from "../../../src/repositories/interfaces/user-repository";
import {
  clearTestContext,
  createInMemoryTestContext,
  type InMemoryTestContext,
} from "../../helpers/memory";

describe("User Routes", () => {
  let ctx: InMemoryTestContext;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ctx = createInMemoryTestContext();
    app = createApp({
      userRepository: ctx.userRepository,
      postRepository: ctx.postRepository,
    });
  });

  afterEach(() => {
    clearTestContext(ctx);
  });

  describe("GET /users", () => {
    it("should return empty list when no users exist", async () => {
      const response = await app.request("/users");

      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        data: User[];
        pagination: { total: number; limit: number; offset: number };
      };

      expect(body.data).toEqual([]);
      expect(body.pagination.total).toBe(0);
      expect(body.pagination.limit).toBe(20);
      expect(body.pagination.offset).toBe(0);
    });

    it("should return list of users with pagination", async () => {
      // Create test users
      await ctx.userRepository.create({
        name: "User 1",
        email: "user1@example.com",
      });
      await ctx.userRepository.create({
        name: "User 2",
        email: "user2@example.com",
      });
      await ctx.userRepository.create({
        name: "User 3",
        email: "user3@example.com",
      });

      const response = await app.request("/users?limit=2&offset=0");

      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        data: User[];
        pagination: { total: number; limit: number; offset: number };
      };

      expect(body.data).toHaveLength(2);
      expect(body.pagination.total).toBe(3);
      expect(body.pagination.limit).toBe(2);
      expect(body.pagination.offset).toBe(0);
    });

    it("should handle offset correctly", async () => {
      await ctx.userRepository.create({
        name: "User 1",
        email: "user1@example.com",
      });
      await ctx.userRepository.create({
        name: "User 2",
        email: "user2@example.com",
      });
      await ctx.userRepository.create({
        name: "User 3",
        email: "user3@example.com",
      });

      const response = await app.request("/users?limit=10&offset=2");

      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        data: User[];
        pagination: { total: number; limit: number; offset: number };
      };

      expect(body.data).toHaveLength(1);
      expect(body.pagination.offset).toBe(2);
    });

    it("should return 400 for invalid limit", async () => {
      const response = await app.request("/users?limit=200");

      expect(response.status).toBe(400);
    });

    it("should return 400 for negative offset", async () => {
      const response = await app.request("/users?offset=-1");

      expect(response.status).toBe(400);
    });
  });

  describe("GET /users/:id", () => {
    it("should return a user by ID", async () => {
      const createResult = await ctx.userRepository.create({
        name: "Test User",
        email: "test@example.com",
      });

      if (createResult.isErr()) throw new Error("Failed to create user");

      const user = createResult.value;
      const response = await app.request(`/users/${user.id}`);

      expect(response.status).toBe(200);

      const body = (await response.json()) as { data: User };

      expect(body.data.id).toBe(user.id);
      expect(body.data.name).toBe("Test User");
      expect(body.data.email).toBe("test@example.com");
    });

    it("should return 404 for non-existent user", async () => {
      const response = await app.request("/users/non-existent-id");

      expect(response.status).toBe(404);

      const body = (await response.json()) as { type: string };
      expect(body.type).toBe("urn:app:error:not-found");
    });

    it("should return 404 for deleted user", async () => {
      const createResult = await ctx.userRepository.create({
        name: "Test User",
        email: "test@example.com",
      });

      if (createResult.isErr()) throw new Error("Failed to create user");

      const user = createResult.value;
      await ctx.userRepository.delete(user.id);

      const response = await app.request(`/users/${user.id}`);

      expect(response.status).toBe(404);
    });
  });

  describe("POST /users", () => {
    it("should create a user and return 201", async () => {
      const response = await app.request("/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test User",
          email: "test@example.com",
        }),
      });

      expect(response.status).toBe(201);

      const body = (await response.json()) as {
        data: { id: string; name: string; email: string };
      };

      expect(body.data).toBeDefined();
      expect(body.data.id).toBeDefined();
      expect(body.data.name).toBe("Test User");
      expect(body.data.email).toBe("test@example.com");
    });

    it("should create a user with image URL", async () => {
      const response = await app.request("/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "User With Image",
          email: "image@example.com",
          image: "https://example.com/avatar.png",
        }),
      });

      expect(response.status).toBe(201);

      const body = (await response.json()) as {
        data: { id: string; image: string };
      };

      expect(body.data.image).toBe("https://example.com/avatar.png");
    });

    it("should return 400 for missing name", async () => {
      const response = await app.request("/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
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

    it("should return 400 for invalid email", async () => {
      const response = await app.request("/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test User",
          email: "invalid-email",
        }),
      });

      expect(response.status).toBe(400);

      const body = (await response.json()) as { type: string };
      expect(body.type).toBe("urn:app:error:validation");
    });

    it("should return 409 for duplicate email", async () => {
      await app.request("/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "First User",
          email: "duplicate@example.com",
        }),
      });

      const response = await app.request("/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Second User",
          email: "duplicate@example.com",
        }),
      });

      expect(response.status).toBe(409);

      const body = (await response.json()) as { type: string };
      expect(body.type).toBe("urn:app:error:conflict");
    });
  });

  describe("PUT /users/:id", () => {
    it("should fully update a user", async () => {
      const createResult = await ctx.userRepository.create({
        name: "Original Name",
        email: "original@example.com",
      });

      if (createResult.isErr()) throw new Error("Failed to create user");

      const user = createResult.value;

      const response = await app.request(`/users/${user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Updated Name",
          email: "updated@example.com",
        }),
      });

      expect(response.status).toBe(200);

      const body = (await response.json()) as { data: User };

      expect(body.data.name).toBe("Updated Name");
      expect(body.data.email).toBe("updated@example.com");
    });

    it("should return 400 for missing required fields", async () => {
      const createResult = await ctx.userRepository.create({
        name: "Test User",
        email: "test@example.com",
      });

      if (createResult.isErr()) throw new Error("Failed to create user");

      const user = createResult.value;

      const response = await app.request(`/users/${user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Updated Name",
          // missing email
        }),
      });

      expect(response.status).toBe(400);
    });

    it("should return 404 for non-existent user", async () => {
      const response = await app.request("/users/non-existent-id", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Updated Name",
          email: "updated@example.com",
        }),
      });

      expect(response.status).toBe(404);
    });

    it("should return 409 for duplicate email", async () => {
      await ctx.userRepository.create({
        name: "Existing User",
        email: "existing@example.com",
      });

      const createResult = await ctx.userRepository.create({
        name: "Test User",
        email: "test@example.com",
      });

      if (createResult.isErr()) throw new Error("Failed to create user");

      const user = createResult.value;

      const response = await app.request(`/users/${user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Updated Name",
          email: "existing@example.com",
        }),
      });

      expect(response.status).toBe(409);
    });
  });

  describe("PATCH /users/:id", () => {
    it("should partially update a user (name only)", async () => {
      const createResult = await ctx.userRepository.create({
        name: "Original Name",
        email: "original@example.com",
      });

      if (createResult.isErr()) throw new Error("Failed to create user");

      const user = createResult.value;

      const response = await app.request(`/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Updated Name",
        }),
      });

      expect(response.status).toBe(200);

      const body = (await response.json()) as { data: User };

      expect(body.data.name).toBe("Updated Name");
      expect(body.data.email).toBe("original@example.com");
    });

    it("should partially update a user (email only)", async () => {
      const createResult = await ctx.userRepository.create({
        name: "Original Name",
        email: "original@example.com",
      });

      if (createResult.isErr()) throw new Error("Failed to create user");

      const user = createResult.value;

      const response = await app.request(`/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "updated@example.com",
        }),
      });

      expect(response.status).toBe(200);

      const body = (await response.json()) as { data: User };

      expect(body.data.name).toBe("Original Name");
      expect(body.data.email).toBe("updated@example.com");
    });

    it("should return 400 for empty update", async () => {
      const createResult = await ctx.userRepository.create({
        name: "Test User",
        email: "test@example.com",
      });

      if (createResult.isErr()) throw new Error("Failed to create user");

      const user = createResult.value;

      const response = await app.request(`/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
    });

    it("should return 404 for non-existent user", async () => {
      const response = await app.request("/users/non-existent-id", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Updated Name",
        }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /users/:id", () => {
    it("should soft delete a user and return 204", async () => {
      const createResult = await ctx.userRepository.create({
        name: "Test User",
        email: "test@example.com",
      });

      if (createResult.isErr()) throw new Error("Failed to create user");

      const user = createResult.value;

      const response = await app.request(`/users/${user.id}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(204);

      // Verify user is no longer accessible
      const getResponse = await app.request(`/users/${user.id}`);
      expect(getResponse.status).toBe(404);
    });

    it("should return 404 for non-existent user", async () => {
      const response = await app.request("/users/non-existent-id", {
        method: "DELETE",
      });

      expect(response.status).toBe(404);
    });

    it("should return 404 for already deleted user", async () => {
      const createResult = await ctx.userRepository.create({
        name: "Test User",
        email: "test@example.com",
      });

      if (createResult.isErr()) throw new Error("Failed to create user");

      const user = createResult.value;

      // First delete
      await app.request(`/users/${user.id}`, { method: "DELETE" });

      // Second delete should fail
      const response = await app.request(`/users/${user.id}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(404);
    });

    it("should not include deleted users in list", async () => {
      const createResult = await ctx.userRepository.create({
        name: "Test User",
        email: "test@example.com",
      });

      if (createResult.isErr()) throw new Error("Failed to create user");

      const user = createResult.value;

      await app.request(`/users/${user.id}`, { method: "DELETE" });

      const listResponse = await app.request("/users");
      const body = (await listResponse.json()) as {
        data: User[];
        pagination: { total: number };
      };

      expect(body.data).toHaveLength(0);
      expect(body.pagination.total).toBe(0);
    });
  });
});
