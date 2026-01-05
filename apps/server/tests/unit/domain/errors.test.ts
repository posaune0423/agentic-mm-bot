/**
 * Domain errors unit tests.
 * Tests error factory functions (pure functions).
 */

import { describe, expect, it } from "bun:test";

import {
  conflictError,
  forbiddenError,
  notFoundError,
  unauthorizedError,
  unexpectedError,
  validationError,
} from "../../../src/domain/errors";

describe("Domain Errors", () => {
  describe("validationError", () => {
    it("should create ValidationError with message only", () => {
      const error = validationError("Invalid input");

      expect(error.type).toBe("ValidationError");
      expect(error.message).toBe("Invalid input");
      expect(error.field).toBeUndefined();
      expect(error.details).toBeUndefined();
    });

    it("should create ValidationError with field and details", () => {
      const error = validationError("Invalid email", {
        field: "email",
        details: [
          {
            field: "email",
            message: "Must be valid email",
            code: "invalid_format",
          },
        ],
      });

      expect(error.type).toBe("ValidationError");
      expect(error.field).toBe("email");
      expect(error.details).toHaveLength(1);
      expect(error.details![0]!.code).toBe("invalid_format");
    });
  });

  describe("notFoundError", () => {
    it("should create NotFoundError with resource only", () => {
      const error = notFoundError("User");

      expect(error.type).toBe("NotFoundError");
      expect(error.message).toBe("User not found");
      expect(error.resource).toBe("User");
      expect(error.id).toBeUndefined();
    });

    it("should create NotFoundError with resource and id", () => {
      const error = notFoundError("User", "123");

      expect(error.type).toBe("NotFoundError");
      expect(error.message).toBe("User with id '123' not found");
      expect(error.resource).toBe("User");
      expect(error.id).toBe("123");
    });
  });

  describe("conflictError", () => {
    it("should create ConflictError with message only", () => {
      const error = conflictError("Resource already exists");

      expect(error.type).toBe("ConflictError");
      expect(error.message).toBe("Resource already exists");
      expect(error.resource).toBeUndefined();
    });

    it("should create ConflictError with options", () => {
      const error = conflictError("Duplicate entry", {
        resource: "User",
        conflictReason: "unique_constraint",
      });

      expect(error.type).toBe("ConflictError");
      expect(error.resource).toBe("User");
      expect(error.conflictReason).toBe("unique_constraint");
    });
  });

  describe("unauthorizedError", () => {
    it("should create UnauthorizedError with default message", () => {
      const error = unauthorizedError();

      expect(error.type).toBe("UnauthorizedError");
      expect(error.message).toBe("Authentication required");
    });

    it("should create UnauthorizedError with custom message", () => {
      const error = unauthorizedError("Invalid token");

      expect(error.type).toBe("UnauthorizedError");
      expect(error.message).toBe("Invalid token");
    });
  });

  describe("forbiddenError", () => {
    it("should create ForbiddenError with message", () => {
      const error = forbiddenError("Access denied");

      expect(error.type).toBe("ForbiddenError");
      expect(error.message).toBe("Access denied");
      expect(error.requiredPermission).toBeUndefined();
    });

    it("should create ForbiddenError with required permission", () => {
      const error = forbiddenError("Access denied", "admin:write");

      expect(error.type).toBe("ForbiddenError");
      expect(error.requiredPermission).toBe("admin:write");
    });
  });

  describe("unexpectedError", () => {
    it("should create UnexpectedError with message", () => {
      const error = unexpectedError("Something went wrong");

      expect(error.type).toBe("UnexpectedError");
      expect(error.message).toBe("Something went wrong");
      expect(error.cause).toBeUndefined();
    });

    it("should create UnexpectedError with cause", () => {
      const cause = new Error("Original error");
      const error = unexpectedError("Wrapped error", cause);

      expect(error.type).toBe("UnexpectedError");
      expect(error.cause).toBe(cause);
    });
  });
});
