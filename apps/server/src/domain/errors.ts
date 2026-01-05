/**
 * Base error types shared across all bounded contexts.
 * All domain errors should extend or compose these types.
 */

/**
 * Base structure for all domain errors.
 * Using discriminated union pattern with `type` field.
 */
export interface BaseError {
  readonly type: string;
  readonly message: string;
}

/**
 * Validation error - invalid input data (VO creation failure, schema mismatch).
 */
export interface ValidationError extends BaseError {
  readonly type: "ValidationError";
  readonly field?: string;
  readonly details?: readonly ValidationDetail[];
}

export interface ValidationDetail {
  readonly field: string;
  readonly message: string;
  readonly code?: string;
}

/**
 * NotFound error - requested resource does not exist.
 */
export interface NotFoundError extends BaseError {
  readonly type: "NotFoundError";
  readonly resource: string;
  readonly id?: string;
}

/**
 * Conflict error - state conflict (unique constraint, invalid state transition).
 */
export interface ConflictError extends BaseError {
  readonly type: "ConflictError";
  readonly resource?: string;
  readonly conflictReason?: string;
}

/**
 * Unauthorized error - authentication required or failed.
 */
export interface UnauthorizedError extends BaseError {
  readonly type: "UnauthorizedError";
}

/**
 * Forbidden error - authenticated but not authorized.
 */
export interface ForbiddenError extends BaseError {
  readonly type: "ForbiddenError";
  readonly requiredPermission?: string;
}

/**
 * Unexpected error - catch-all for unhandled cases (should log details, not expose).
 */
export interface UnexpectedError extends BaseError {
  readonly type: "UnexpectedError";
  readonly cause?: unknown;
}

/**
 * Union of all standard domain errors.
 * Extend this in each bounded context if needed.
 */
export type DomainError =
  | ValidationError
  | NotFoundError
  | ConflictError
  | UnauthorizedError
  | ForbiddenError
  | UnexpectedError;

// Factory functions for creating errors (pure, no throw)

export const validationError = (
  message: string,
  options?: { field?: string; details?: ValidationDetail[] },
): ValidationError => ({
  type: "ValidationError",
  message,
  field: options?.field,
  details: options?.details,
});

export const notFoundError = (
  resource: string,
  id?: string,
): NotFoundError => ({
  type: "NotFoundError",
  message: `${resource}${id ? ` with id '${id}'` : ""} not found`,
  resource,
  id,
});

export const conflictError = (
  message: string,
  options?: { resource?: string; conflictReason?: string },
): ConflictError => ({
  type: "ConflictError",
  message,
  resource: options?.resource,
  conflictReason: options?.conflictReason,
});

export const unauthorizedError = (
  message = "Authentication required",
): UnauthorizedError => ({
  type: "UnauthorizedError",
  message,
});

export const forbiddenError = (
  message: string,
  requiredPermission?: string,
): ForbiddenError => ({
  type: "ForbiddenError",
  message,
  requiredPermission,
});

export const unexpectedError = (
  message: string,
  cause?: unknown,
): UnexpectedError => ({
  type: "UnexpectedError",
  message,
  cause,
});
