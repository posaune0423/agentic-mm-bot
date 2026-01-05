/**
 * HTTP error mapping tests.
 * Tests toHttpError function (pure function).
 */

import { describe, expect, it } from "bun:test";
import { z } from "zod";

import {
  conflictError,
  forbiddenError,
  notFoundError,
  unauthorizedError,
  unexpectedError,
  validationError,
} from "../../../src/domain/errors";
import { toHttpError } from "../../../src/utils/http-error";

describe("toHttpError", () => {
  describe("domain errors", () => {
    it("should map ValidationError to 400", () => {
      const error = validationError("Invalid input", {
        field: "email",
        details: [{ field: "email", message: "Must be valid email" }],
      });

      const result = toHttpError(error, "/api/test");

      expect(result.status).toBe(400);
      expect(result.body.type).toBe("urn:app:error:validation");
      expect(result.body.title).toBe("Validation Error");
      expect(result.body.status).toBe(400);
      expect(result.body.detail).toBe("Invalid input");
      expect(result.body.instance).toBe("/api/test");
      expect(result.body.errors).toHaveLength(1);
    });

    it("should map NotFoundError to 404", () => {
      const error = notFoundError("User", "123");

      const result = toHttpError(error);

      expect(result.status).toBe(404);
      expect(result.body.type).toBe("urn:app:error:not-found");
      expect(result.body.title).toBe("Not Found");
      expect(result.body.detail).toContain("User");
    });

    it("should map ConflictError to 409", () => {
      const error = conflictError("Resource already exists");

      const result = toHttpError(error);

      expect(result.status).toBe(409);
      expect(result.body.type).toBe("urn:app:error:conflict");
      expect(result.body.title).toBe("Conflict");
    });

    it("should map UnauthorizedError to 401", () => {
      const error = unauthorizedError("Invalid token");

      const result = toHttpError(error);

      expect(result.status).toBe(401);
      expect(result.body.type).toBe("urn:app:error:unauthorized");
      expect(result.body.title).toBe("Unauthorized");
    });

    it("should map ForbiddenError to 403", () => {
      const error = forbiddenError("Access denied");

      const result = toHttpError(error);

      expect(result.status).toBe(403);
      expect(result.body.type).toBe("urn:app:error:forbidden");
      expect(result.body.title).toBe("Forbidden");
    });

    it("should map UnexpectedError to 500 with safe message", () => {
      const error = unexpectedError("Database connection failed");

      const result = toHttpError(error);

      expect(result.status).toBe(500);
      expect(result.body.type).toBe("urn:app:error:unexpected");
      expect(result.body.title).toBe("Internal Server Error");
      // Should not expose internal error details
      expect(result.body.detail).toBe("An unexpected error occurred");
    });
  });

  describe("ZodError", () => {
    it("should map ZodError to 400 with field details", () => {
      const schema = z.object({
        email: z.string().email(),
        age: z.number().min(0),
      });

      const parseResult = schema.safeParse({ email: "invalid", age: -1 });
      expect(parseResult.success).toBe(false);

      if (!parseResult.success) {
        const result = toHttpError(parseResult.error, "/api/users");

        expect(result.status).toBe(400);
        expect(result.body.type).toBe("urn:app:error:validation");
        expect(result.body.detail).toBe("Request validation failed");
        expect(result.body.errors).toBeDefined();
        expect(result.body.errors!.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe("headers", () => {
    it("should include Content-Type application/problem+json", () => {
      const error = notFoundError("User");

      const result = toHttpError(error);

      expect(result.headers).toBeDefined();
      expect(result.headers!["Content-Type"]).toBe("application/problem+json");
    });
  });
});
