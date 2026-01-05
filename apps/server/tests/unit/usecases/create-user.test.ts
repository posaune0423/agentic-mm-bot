/**
 * Create User UseCase unit tests.
 * Tests business logic with in-memory repositories.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { executeCreateUser } from "../../../src/usecases/create-user/usecase";
import {
  clearTestContext,
  createInMemoryTestContext,
  type InMemoryTestContext,
} from "../../helpers/memory";

describe("executeCreateUser", () => {
  let ctx: InMemoryTestContext;

  beforeEach(() => {
    ctx = createInMemoryTestContext();
  });

  afterEach(() => {
    clearTestContext(ctx);
  });

  describe("successful creation", () => {
    it("should create a user with valid input", async () => {
      const result = await executeCreateUser(
        {
          userRepository: ctx.userRepository,
          userAuthenticationService: ctx.userAuthenticationService,
        },
        { name: "Test User", email: "test@example.com" },
      );

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        expect(result.value.user.name).toBe("Test User");
        expect(result.value.user.email).toBe("test@example.com");
        expect(result.value.user.id).toBeDefined();
        expect(result.value.user.createdAt).toBeInstanceOf(Date);
      }
    });

    it("should create a user with optional image", async () => {
      const result = await executeCreateUser(
        {
          userRepository: ctx.userRepository,
          userAuthenticationService: ctx.userAuthenticationService,
        },
        {
          name: "User With Image",
          email: "image@example.com",
          image: "https://example.com/avatar.png",
        },
      );

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        expect(result.value.user.image).toBe("https://example.com/avatar.png");
      }
    });

    it("should create a user without image (null)", async () => {
      const result = await executeCreateUser(
        {
          userRepository: ctx.userRepository,
          userAuthenticationService: ctx.userAuthenticationService,
        },
        { name: "No Image User", email: "noimage@example.com" },
      );

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        expect(result.value.user.image).toBeNull();
      }
    });
  });

  describe("conflict errors", () => {
    it("should return ConflictError when email already exists", async () => {
      // First, create a user
      await executeCreateUser(
        {
          userRepository: ctx.userRepository,
          userAuthenticationService: ctx.userAuthenticationService,
        },
        { name: "First User", email: "duplicate@example.com" },
      );

      // Try to create another user with the same email
      const result = await executeCreateUser(
        {
          userRepository: ctx.userRepository,
          userAuthenticationService: ctx.userAuthenticationService,
        },
        { name: "Second User", email: "duplicate@example.com" },
      );

      expect(result.isErr()).toBe(true);

      if (result.isErr()) {
        expect(result.error.type).toBe("ConflictError");
        expect(result.error.message).toContain("duplicate@example.com");
      }
    });

    it("should allow different emails for different users", async () => {
      const result1 = await executeCreateUser(
        {
          userRepository: ctx.userRepository,
          userAuthenticationService: ctx.userAuthenticationService,
        },
        { name: "User One", email: "user1@example.com" },
      );

      const result2 = await executeCreateUser(
        {
          userRepository: ctx.userRepository,
          userAuthenticationService: ctx.userAuthenticationService,
        },
        { name: "User Two", email: "user2@example.com" },
      );

      expect(result1.isOk()).toBe(true);
      expect(result2.isOk()).toBe(true);
    });
  });

  describe("email verification", () => {
    it("should check email existence before creation", async () => {
      // Create first user
      const firstResult = await executeCreateUser(
        {
          userRepository: ctx.userRepository,
          userAuthenticationService: ctx.userAuthenticationService,
        },
        { name: "First", email: "check@example.com" },
      );

      expect(firstResult.isOk()).toBe(true);

      // Verify user can be found
      const findResult =
        await ctx.userRepository.findByEmail("check@example.com");

      expect(findResult.isOk()).toBe(true);

      if (findResult.isOk()) {
        expect(findResult.value).not.toBeNull();
        expect(findResult.value?.name).toBe("First");
      }
    });
  });
});
