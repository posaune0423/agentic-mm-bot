/**
 * In-Memory User Repository implementation.
 * Used for testing without database dependencies.
 */

import { type Result, err, ok } from "neverthrow";

import { conflictError, notFoundError } from "../../domain/errors";
import type {
  CreateUserInput,
  FindAllUsersOptions,
  FindAllUsersResult,
  UpdateUserInput,
  User,
  UserRepository,
  UserRepositoryError,
} from "../interfaces/user-repository";

/**
 * Create an in-memory User Repository.
 * Data is stored in a Map and cleared when the repository is recreated.
 *
 * @returns UserRepository implementation
 */
export const createInMemoryUserRepository = (): UserRepository & {
  clear: () => void;
} => {
  const users = new Map<string, User>();

  return {
    async findById(
      id: string,
    ): Promise<Result<User | null, UserRepositoryError>> {
      const user = users.get(id);

      if (user?.deletedAt) {
        return ok(null);
      }

      return ok(user ?? null);
    },

    async findByEmail(
      email: string,
    ): Promise<Result<User | null, UserRepositoryError>> {
      for (const user of users.values()) {
        if (user.email === email && !user.deletedAt) {
          return ok(user);
        }
      }

      return ok(null);
    },

    async findAll(
      options: FindAllUsersOptions,
    ): Promise<Result<FindAllUsersResult, UserRepositoryError>> {
      const activeUsers = Array.from(users.values()).filter(
        (user) => !user.deletedAt,
      );
      const total = activeUsers.length;
      const sliced = activeUsers.slice(
        options.offset,
        options.offset + options.limit,
      );

      return ok({ users: sliced, total });
    },

    async create(
      input: CreateUserInput,
    ): Promise<Result<User, UserRepositoryError>> {
      // Check for existing email (exclude deleted users)
      for (const user of users.values()) {
        if (user.email === input.email && !user.deletedAt) {
          return err(
            conflictError(`User with email '${input.email}' already exists`, {
              resource: "User",
              conflictReason: "duplicate_email",
            }),
          );
        }
      }

      const now = new Date();
      const newUser: User = {
        id: crypto.randomUUID(),
        name: input.name,
        email: input.email,
        emailVerified: null,
        image: input.image ?? null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };

      users.set(newUser.id, newUser);

      return ok(newUser);
    },

    async update(
      id: string,
      input: UpdateUserInput,
    ): Promise<Result<User, UserRepositoryError>> {
      const existing = users.get(id);

      if (!existing || existing.deletedAt) {
        return err(notFoundError("User", id));
      }

      // Check for email conflict if email is being updated
      if (input.email && input.email !== existing.email) {
        for (const user of users.values()) {
          if (user.email === input.email && !user.deletedAt && user.id !== id) {
            return err(
              conflictError(`User with email '${input.email}' already exists`, {
                resource: "User",
                conflictReason: "duplicate_email",
              }),
            );
          }
        }
      }

      const updatedUser: User = {
        ...existing,
        name: input.name ?? existing.name,
        email: input.email ?? existing.email,
        image: input.image !== undefined ? input.image : existing.image,
        updatedAt: new Date(),
      };

      users.set(id, updatedUser);

      return ok(updatedUser);
    },

    async delete(id: string): Promise<Result<void, UserRepositoryError>> {
      const existing = users.get(id);

      if (!existing || existing.deletedAt) {
        return err(notFoundError("User", id));
      }

      const deletedUser: User = {
        ...existing,
        deletedAt: new Date(),
      };

      users.set(id, deletedUser);

      return ok(undefined);
    },

    /**
     * Clear all users from the repository.
     * Useful for test cleanup.
     */
    clear(): void {
      users.clear();
    },
  };
};
