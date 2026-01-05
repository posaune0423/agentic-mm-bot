/**
 * Unit tests for UserAuthenticationService.
 */

import { describe, expect, it } from "bun:test";
import { err, ok } from "neverthrow";

import { createUserAuthenticationService } from "../../../../src/domain/services/user-authentication-service";

describe("UserAuthenticationService", () => {
  // Mock user data
  const mockUser = {
    id: "user-1",
    name: "Test User",
    email: "test@example.com",
    emailVerified: new Date("2024-01-01"),
    image: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    deletedAt: null,
  };

  const mockDeletedUser = {
    ...mockUser,
    id: "user-2",
    email: "deleted@example.com",
    deletedAt: new Date("2024-01-02"),
  };

  describe("authenticateByEmail", () => {
    it("should return user when email exists and is verified", async () => {
      const mockUserRepository = {
        findByEmail: async (email: string) => {
          if (email === mockUser.email) {
            return ok(mockUser);
          }
          return ok(null);
        },
      };

      const service = createUserAuthenticationService({
        userRepository: mockUserRepository,
      });

      const result = await service.authenticateByEmail({
        email: "test@example.com",
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).not.toBeNull();
        expect(result.value?.user.email).toBe("test@example.com");
        expect(result.value?.isEmailVerified).toBe(true);
      }
    });

    it("should return null when user does not exist", async () => {
      const mockUserRepository = {
        findByEmail: async () => ok(null),
      };

      const service = createUserAuthenticationService({
        userRepository: mockUserRepository,
      });

      const result = await service.authenticateByEmail({
        email: "nonexistent@example.com",
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeNull();
      }
    });

    it("should return null when user is soft-deleted", async () => {
      const mockUserRepository = {
        findByEmail: async (email: string) => {
          if (email === mockDeletedUser.email) {
            return ok(mockDeletedUser);
          }
          return ok(null);
        },
      };

      const service = createUserAuthenticationService({
        userRepository: mockUserRepository,
      });

      const result = await service.authenticateByEmail({
        email: "deleted@example.com",
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeNull();
      }
    });

    it("should return error when email format is invalid", async () => {
      const mockUserRepository = {
        findByEmail: async () => ok(null),
      };

      const service = createUserAuthenticationService({
        userRepository: mockUserRepository,
      });

      const result = await service.authenticateByEmail({
        email: "invalid-email",
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("ValidationError");
        expect(result.error.message).toContain("Invalid email format");
      }
    });

    it("should return error when repository fails", async () => {
      const mockUserRepository = {
        findByEmail: async () =>
          err({
            type: "UnexpectedError",
            message: "Database connection failed",
          }),
      };

      const service = createUserAuthenticationService({
        userRepository: mockUserRepository,
      });

      const result = await service.authenticateByEmail({
        email: "test@example.com",
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("ValidationError");
        expect(result.error.message).toContain("Failed to find user");
      }
    });
  });

  describe("isEmailAvailable", () => {
    it("should return true when email is not taken", async () => {
      const mockUserRepository = {
        findByEmail: async () => ok(null),
      };

      const service = createUserAuthenticationService({
        userRepository: mockUserRepository,
      });

      const result = await service.isEmailAvailable("available@example.com");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    });

    it("should return false when email is already taken", async () => {
      const mockUserRepository = {
        findByEmail: async (email: string) => {
          if (email === mockUser.email) {
            return ok(mockUser);
          }
          return ok(null);
        },
      };

      const service = createUserAuthenticationService({
        userRepository: mockUserRepository,
      });

      const result = await service.isEmailAvailable("test@example.com");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(false);
      }
    });

    it("should return true when email belongs to deleted user", async () => {
      const mockUserRepository = {
        findByEmail: async (email: string) => {
          if (email === mockDeletedUser.email) {
            return ok(mockDeletedUser);
          }
          return ok(null);
        },
      };

      const service = createUserAuthenticationService({
        userRepository: mockUserRepository,
      });

      const result = await service.isEmailAvailable("deleted@example.com");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    });

    it("should return error when email format is invalid", async () => {
      const mockUserRepository = {
        findByEmail: async () => ok(null),
      };

      const service = createUserAuthenticationService({
        userRepository: mockUserRepository,
      });

      const result = await service.isEmailAvailable("invalid-email");

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("ValidationError");
      }
    });
  });

  describe("validateEmailFormat", () => {
    it("should return ok for valid email", () => {
      const mockUserRepository = {
        findByEmail: async () => ok(null),
      };
      const service = createUserAuthenticationService({
        userRepository: mockUserRepository,
      });

      const result = service.validateEmailFormat("valid@example.com");

      expect(result.isOk()).toBe(true);
    });

    it("should return error for empty email", () => {
      const mockUserRepository = {
        findByEmail: async () => ok(null),
      };
      const service = createUserAuthenticationService({
        userRepository: mockUserRepository,
      });

      const result = service.validateEmailFormat("");

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe("Email is required");
      }
    });

    it("should return error for email without @", () => {
      const mockUserRepository = {
        findByEmail: async () => ok(null),
      };
      const service = createUserAuthenticationService({
        userRepository: mockUserRepository,
      });

      const result = service.validateEmailFormat("invalidemail.com");

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe("Invalid email format");
      }
    });

    it("should return error for email without domain", () => {
      const mockUserRepository = {
        findByEmail: async () => ok(null),
      };
      const service = createUserAuthenticationService({
        userRepository: mockUserRepository,
      });

      const result = service.validateEmailFormat("user@");

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe("Invalid email format");
      }
    });

    it("should return error for email that is too long", () => {
      const mockUserRepository = {
        findByEmail: async () => ok(null),
      };
      const service = createUserAuthenticationService({
        userRepository: mockUserRepository,
      });

      const longEmail = "a".repeat(250) + "@example.com";
      const result = service.validateEmailFormat(longEmail);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain("too long");
      }
    });
  });
});
