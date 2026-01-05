/**
 * User Repository interface (Domain Port-like contract kept in repositories layer).
 * Defines the contract for user persistence.
 * Implementations are in repositories/postgres, repositories/memory, etc.
 */

import type { Result } from "neverthrow";

import type {
  ConflictError,
  NotFoundError,
  UnexpectedError,
} from "../../domain/errors";

/**
 * User entity shape (for repository operations).
 */
export interface User {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: Date | null;
  readonly image: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

/**
 * Input for creating a new user.
 */
export interface CreateUserInput {
  readonly name: string;
  readonly email: string;
  readonly image?: string | null;
}

/**
 * Input for updating a user.
 * All fields are optional for partial updates.
 */
export interface UpdateUserInput {
  readonly name?: string;
  readonly email?: string;
  readonly image?: string | null;
}

/**
 * Options for listing users.
 */
export interface FindAllUsersOptions {
  readonly limit: number;
  readonly offset: number;
}

/**
 * Result of listing users with pagination info.
 */
export interface FindAllUsersResult {
  readonly users: readonly User[];
  readonly total: number;
}

/**
 * Repository error types.
 */
export type UserRepositoryError =
  | NotFoundError
  | ConflictError
  | UnexpectedError;

/**
 * User Repository interface.
 * All methods return Result for consistent error handling.
 */
export interface UserRepository {
  /**
   * Find user by ID.
   * Returns null if not found (not an error).
   */
  findById(id: string): Promise<Result<User | null, UserRepositoryError>>;

  /**
   * Find user by email.
   * Returns null if not found (not an error).
   */
  findByEmail(email: string): Promise<Result<User | null, UserRepositoryError>>;

  /**
   * Find all users with pagination.
   * Excludes soft-deleted users.
   */
  findAll(
    options: FindAllUsersOptions,
  ): Promise<Result<FindAllUsersResult, UserRepositoryError>>;

  /**
   * Create a new user.
   * Returns ConflictError if email already exists.
   */
  create(input: CreateUserInput): Promise<Result<User, UserRepositoryError>>;

  /**
   * Update an existing user.
   * Returns NotFoundError if user does not exist.
   * Returns ConflictError if email already exists.
   */
  update(
    id: string,
    input: UpdateUserInput,
  ): Promise<Result<User, UserRepositoryError>>;

  /**
   * Soft delete a user by setting deletedAt.
   * Returns NotFoundError if user does not exist.
   */
  delete(id: string): Promise<Result<void, UserRepositoryError>>;
}
