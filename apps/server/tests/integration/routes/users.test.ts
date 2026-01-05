/**
 * User routes integration tests.
 * Tests HTTP layer with in-memory repositories.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createApp } from "../../../src/app";
import type { User } from "../../../src/repositories/interfaces/user-repository";
import {
  clearTestContext,
  createInMemoryTestContext,
  type InMemoryTestContext,
} from "../../helpers/memory";

describe("User Routes Integration", () => {
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

  describe("CRUD Operations Flow", () => {
    it("should complete a full CRUD lifecycle", async () => {
      // CREATE
      const createResponse = await app.request("/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test User",
          email: "test@example.com",
        }),
      });

      expect(createResponse.status).toBe(201);

      const createBody = (await createResponse.json()) as { data: User };
      const userId = createBody.data.id;

      expect(userId).toBeDefined();

      // READ (single)
      const getResponse = await app.request(`/users/${userId}`);

      expect(getResponse.status).toBe(200);

      const getBody = (await getResponse.json()) as { data: User };

      expect(getBody.data.name).toBe("Test User");
      expect(getBody.data.email).toBe("test@example.com");

      // READ (list)
      const listResponse = await app.request("/users");

      expect(listResponse.status).toBe(200);

      const listBody = (await listResponse.json()) as {
        data: User[];
        pagination: { total: number };
      };

      expect(listBody.data).toHaveLength(1);
      expect(listBody.pagination.total).toBe(1);

      // UPDATE (PUT)
      const putResponse = await app.request(`/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Updated Name",
          email: "updated@example.com",
        }),
      });

      expect(putResponse.status).toBe(200);

      const putBody = (await putResponse.json()) as { data: User };

      expect(putBody.data.name).toBe("Updated Name");
      expect(putBody.data.email).toBe("updated@example.com");

      // UPDATE (PATCH)
      const patchResponse = await app.request(`/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Patched Name",
        }),
      });

      expect(patchResponse.status).toBe(200);

      const patchBody = (await patchResponse.json()) as { data: User };

      expect(patchBody.data.name).toBe("Patched Name");
      expect(patchBody.data.email).toBe("updated@example.com");

      // DELETE
      const deleteResponse = await app.request(`/users/${userId}`, {
        method: "DELETE",
      });

      expect(deleteResponse.status).toBe(204);

      // Verify user is no longer accessible
      const getAfterDeleteResponse = await app.request(`/users/${userId}`);

      expect(getAfterDeleteResponse.status).toBe(404);

      // Verify user is not in list
      const listAfterDeleteResponse = await app.request("/users");
      const listAfterDeleteBody = (await listAfterDeleteResponse.json()) as {
        data: User[];
        pagination: { total: number };
      };

      expect(listAfterDeleteBody.data).toHaveLength(0);
      expect(listAfterDeleteBody.pagination.total).toBe(0);
    });

    it("should handle pagination correctly with multiple users", async () => {
      // Create 5 users
      for (let i = 1; i <= 5; i++) {
        await app.request("/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `User ${i}`,
            email: `user${i}@example.com`,
          }),
        });
      }

      // Get first page
      const page1Response = await app.request("/users?limit=2&offset=0");
      const page1Body = (await page1Response.json()) as {
        data: User[];
        pagination: { total: number; limit: number; offset: number };
      };

      expect(page1Body.data).toHaveLength(2);
      expect(page1Body.pagination.total).toBe(5);
      expect(page1Body.pagination.limit).toBe(2);
      expect(page1Body.pagination.offset).toBe(0);

      // Get second page
      const page2Response = await app.request("/users?limit=2&offset=2");
      const page2Body = (await page2Response.json()) as {
        data: User[];
        pagination: { total: number; limit: number; offset: number };
      };

      expect(page2Body.data).toHaveLength(2);
      expect(page2Body.pagination.offset).toBe(2);

      // Get third page
      const page3Response = await app.request("/users?limit=2&offset=4");
      const page3Body = (await page3Response.json()) as {
        data: User[];
        pagination: { total: number };
      };

      expect(page3Body.data).toHaveLength(1);
    });

    it("should prevent duplicate email during creation and update", async () => {
      // Create first user
      await app.request("/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "First User",
          email: "taken@example.com",
        }),
      });

      // Create second user
      const secondUserResponse = await app.request("/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Second User",
          email: "second@example.com",
        }),
      });

      const secondUserBody = (await secondUserResponse.json()) as {
        data: User;
      };
      const secondUserId = secondUserBody.data.id;

      // Try to create with duplicate email
      const duplicateCreateResponse = await app.request("/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Third User",
          email: "taken@example.com",
        }),
      });

      expect(duplicateCreateResponse.status).toBe(409);

      // Try to update to duplicate email
      const duplicateUpdateResponse = await app.request(
        `/users/${secondUserId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Second User Updated",
            email: "taken@example.com",
          }),
        },
      );

      expect(duplicateUpdateResponse.status).toBe(409);
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
});
