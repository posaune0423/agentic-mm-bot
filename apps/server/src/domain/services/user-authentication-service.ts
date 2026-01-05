/**
 * User Authentication Domain Service.
 *
 * Handles business logic related to user authentication and validation.
 * This service coordinates multiple repositories and enforces domain rules
 * that don't naturally belong to a single entity.
 */

import type { Result } from "neverthrow";
import { err, ok } from "neverthrow";

import type { ConflictError, ValidationError } from "../errors";

type RepoError = {
  readonly message: string;
};

type User = {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: Date | null;
  readonly deletedAt: Date | null;
};

type UserByEmailReader = {
  findByEmail(email: string): Promise<Result<User | null, RepoError>>;
};

/**
 * Input for authenticating a user by email.
 */
export interface AuthenticateUserByEmailInput {
  readonly email: string;
}

/**
 * Result of user authentication.
 */
export interface AuthenticationResult {
  readonly user: User;
  readonly isEmailVerified: boolean;
}

/**
 * Error types for authentication service.
 */
export type AuthenticationServiceError = ValidationError | ConflictError;

/**
 * User Authentication Service interface.
 * Encapsulates authentication-related business logic.
 */
export interface UserAuthenticationService {
  /**
   * Authenticate user by email.
   * Returns user if found and validates email format.
   */
  authenticateByEmail(
    input: AuthenticateUserByEmailInput,
  ): Promise<Result<AuthenticationResult | null, AuthenticationServiceError>>;

  /**
   * Check if email is available for registration.
   * Returns true if email is not taken.
   */
  isEmailAvailable(
    email: string,
  ): Promise<Result<boolean, AuthenticationServiceError>>;

  /**
   * Validate email format according to domain rules.
   */
  validateEmailFormat(email: string): Result<void, ValidationError>;
}

/**
 * Dependencies for creating UserAuthenticationService.
 */
export interface CreateUserAuthenticationServiceDeps {
  readonly userRepository: UserByEmailReader;
}

/**
 * Email validation regex (simple pattern).
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Create UserAuthenticationService instance.
 */
export function createUserAuthenticationService(
  deps: CreateUserAuthenticationServiceDeps,
): UserAuthenticationService {
  const { userRepository } = deps;

  return {
    async authenticateByEmail(input) {
      const { email } = input;

      // Validate email format first
      const validationResult = this.validateEmailFormat(email);
      if (validationResult.isErr()) {
        return err(validationResult.error);
      }

      // Find user by email
      const userResult = await userRepository.findByEmail(email);
      if (userResult.isErr()) {
        return err({
          type: "ValidationError",
          message: `Failed to find user: ${userResult.error.message}`,
        });
      }

      const user = userResult.value;
      if (!user) {
        return ok(null);
      }

      // Check if user is soft-deleted
      if (user.deletedAt !== null) {
        return ok(null);
      }

      return ok({
        user,
        isEmailVerified: user.emailVerified !== null,
      });
    },

    async isEmailAvailable(email) {
      // Validate email format first
      const validationResult = this.validateEmailFormat(email);
      if (validationResult.isErr()) {
        return err(validationResult.error);
      }

      // Check if email exists
      const userResult = await userRepository.findByEmail(email);
      if (userResult.isErr()) {
        return err({
          type: "ValidationError",
          message: `Failed to check email availability: ${userResult.error.message}`,
        });
      }

      const user = userResult.value;

      // Email is available if user doesn't exist or is soft-deleted
      return ok(user === null || user.deletedAt !== null);
    },

    validateEmailFormat(email) {
      if (!email || email.trim() === "") {
        return err({
          type: "ValidationError",
          message: "Email is required",
        });
      }

      if (!EMAIL_REGEX.test(email)) {
        return err({
          type: "ValidationError",
          message: "Invalid email format",
        });
      }

      if (email.length > 255) {
        return err({
          type: "ValidationError",
          message: "Email is too long (max 255 characters)",
        });
      }

      return ok(undefined);
    },
  };
}
