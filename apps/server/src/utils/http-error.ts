/**
 * HTTP Error Utilities - centralized conversion from domain/usecase errors to HTTP responses.
 */

import type { Context } from "hono";
import type { ZodError } from "zod";

import type { DomainError } from "../domain/errors";
import {
  ERROR_STATUS_CODES,
  ERROR_TITLES,
  ERROR_TYPE_URNS,
  type HttpErrorResponse,
  type ProblemDetails,
  zodErrorToDetails,
} from "../types/http-error";

/**
 * Convert domain/usecase error to HTTP error response.
 * Pure function - no side effects, easy to test.
 *
 * @param error - Domain error, Usecase error, or ZodError
 * @param instance - Request path or identifier for the specific occurrence
 * @returns HTTP error response with status, body, and optional headers
 */
export const toHttpError = (
  error: DomainError | ZodError,
  instance?: string,
): HttpErrorResponse => {
  // Handle ZodError (from DTO validation)
  if ("issues" in error && Array.isArray(error.issues)) {
    const zodError = error as ZodError;
    return {
      status: 400,
      body: {
        type: ERROR_TYPE_URNS.ZodError,
        title: ERROR_TITLES.ZodError!,
        status: 400,
        detail: "Request validation failed",
        instance,
        errors: zodErrorToDetails(zodError),
      },
      headers: { "Content-Type": "application/problem+json" },
    };
  }

  // Handle domain errors
  const domainError = error as DomainError;
  const errorType = domainError.type;
  const status = ERROR_STATUS_CODES[errorType] ?? 500;
  const title = ERROR_TITLES[errorType] ?? "Internal Server Error";
  const typeUrn =
    ERROR_TYPE_URNS[errorType as keyof typeof ERROR_TYPE_URNS] ??
    ERROR_TYPE_URNS.UnexpectedError;

  const body: ProblemDetails = {
    type: typeUrn,
    title,
    status,
    detail:
      status === 500 ? "An unexpected error occurred" : domainError.message,
    instance,
  };

  // Add validation details if present
  if (domainError.type === "ValidationError" && domainError.details) {
    return {
      status,
      body: { ...body, errors: domainError.details },
      headers: { "Content-Type": "application/problem+json" },
    };
  }

  return {
    status,
    body,
    headers: { "Content-Type": "application/problem+json" },
  };
};

/**
 * Helper to send HTTP error response from Hono context.
 * Use this in route handlers after Result.isErr() check.
 */
export const sendHttpError = (
  c: Context,
  error: DomainError | ZodError,
): Response => {
  const { status, body, headers } = toHttpError(error, c.req.path);

  return c.json(body, status as 400 | 401 | 403 | 404 | 409 | 500, headers);
};
