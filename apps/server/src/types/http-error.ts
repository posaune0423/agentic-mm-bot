/**
 * HTTP Error Types - Problem Details (RFC7807) response format.
 */

import type { ZodError } from "zod";

import type { ValidationDetail } from "../domain/errors";

/**
 * Problem Details response body (RFC7807-like).
 */
export interface ProblemDetails {
  /** URI reference identifying the problem type */
  readonly type: string;
  /** Short human-readable summary */
  readonly title: string;
  /** HTTP status code */
  readonly status: number;
  /** Human-readable explanation (no sensitive data) */
  readonly detail: string;
  /** URI reference to the specific occurrence (request path or id) */
  readonly instance?: string;
  /** Validation error details (for 400 responses) */
  readonly errors?: readonly ValidationDetail[];
  /** Additional metadata (debug info, suppress in production) */
  readonly meta?: Record<string, unknown>;
}

/**
 * HTTP error response structure returned by toHttpError.
 */
export interface HttpErrorResponse {
  readonly status: number;
  readonly body: ProblemDetails;
  readonly headers?: Record<string, string>;
}

/**
 * Error type URNs for consistent identification.
 */
export const ERROR_TYPE_URNS = {
  ValidationError: "urn:app:error:validation",
  NotFoundError: "urn:app:error:not-found",
  ConflictError: "urn:app:error:conflict",
  UnauthorizedError: "urn:app:error:unauthorized",
  ForbiddenError: "urn:app:error:forbidden",
  UnexpectedError: "urn:app:error:unexpected",
  ZodError: "urn:app:error:validation",
} as const;

/**
 * HTTP status codes for each error type.
 */
export const ERROR_STATUS_CODES: Record<string, number> = {
  ValidationError: 400,
  NotFoundError: 404,
  ConflictError: 409,
  UnauthorizedError: 401,
  ForbiddenError: 403,
  UnexpectedError: 500,
  ZodError: 400,
};

/**
 * Human-readable titles for each error type.
 */
export const ERROR_TITLES: Record<string, string> = {
  ValidationError: "Validation Error",
  NotFoundError: "Not Found",
  ConflictError: "Conflict",
  UnauthorizedError: "Unauthorized",
  ForbiddenError: "Forbidden",
  UnexpectedError: "Internal Server Error",
  ZodError: "Validation Error",
};

/**
 * Convert a Zod error to ValidationDetail array.
 */
export const zodErrorToDetails = (error: ZodError): ValidationDetail[] =>
  error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));
