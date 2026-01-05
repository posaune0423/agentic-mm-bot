/**
 * Postgres User Repository implementation using Drizzle ORM.
 */

import { and, count, eq, isNull } from "drizzle-orm";
import { type Result, err, ok } from "neverthrow";

import { users } from "@bun-hono-ddd-template/db";

import {
  conflictError,
  notFoundError,
  unexpectedError,
} from "../../domain/errors";
import type {
  CreateUserInput,
  FindAllUsersOptions,
  FindAllUsersResult,
  UpdateUserInput,
  User,
  UserRepository,
  UserRepositoryError,
} from "../interfaces/user-repository";
import type { Database } from "./db";

/**
 * Map database row to User entity.
 */
const toUser = (row: typeof users.$inferSelect): User => ({
  id: row.id,
  name: row.name,
  email: row.email,
  emailVerified: row.emailVerified,
  image: row.image,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt,
});

/**
 * Check if error is a Postgres unique violation (code 23505).
 */
const isUniqueViolation = (error: unknown): boolean => {
  if (typeof error === "object" && error !== null && "code" in error) {
    return (error as { code: string }).code === "23505";
  }
  return false;
};

/**
 * Create a Postgres User Repository.
 *
 * @param db - Drizzle database instance
 * @returns UserRepository implementation
 */
export const createPostgresUserRepository = (db: Database): UserRepository => ({
  async findById(
    id: string,
  ): Promise<Result<User | null, UserRepositoryError>> {
    try {
      const result = await db
        .select()
        .from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .limit(1);

      return ok(result[0] ? toUser(result[0]) : null);
    } catch (error) {
      return err(unexpectedError("Failed to find user by id", error));
    }
  },

  async findByEmail(
    email: string,
  ): Promise<Result<User | null, UserRepositoryError>> {
    try {
      const result = await db
        .select()
        .from(users)
        .where(and(eq(users.email, email), isNull(users.deletedAt)))
        .limit(1);

      return ok(result[0] ? toUser(result[0]) : null);
    } catch (error) {
      return err(unexpectedError("Failed to find user by email", error));
    }
  },

  async findAll(
    options: FindAllUsersOptions,
  ): Promise<Result<FindAllUsersResult, UserRepositoryError>> {
    try {
      const [usersResult, countResult] = await Promise.all([
        db
          .select()
          .from(users)
          .where(isNull(users.deletedAt))
          .limit(options.limit)
          .offset(options.offset),
        db
          .select({ count: count() })
          .from(users)
          .where(isNull(users.deletedAt)),
      ]);

      return ok({
        users: usersResult.map(toUser),
        total: countResult[0]?.count ?? 0,
      });
    } catch (error) {
      return err(unexpectedError("Failed to find all users", error));
    }
  },

  async create(
    input: CreateUserInput,
  ): Promise<Result<User, UserRepositoryError>> {
    try {
      const result = await db
        .insert(users)
        .values({
          name: input.name,
          email: input.email,
          image: input.image ?? null,
        })
        .returning();

      const created = result[0];

      if (!created) {
        return err(unexpectedError("User creation returned no result"));
      }

      return ok(toUser(created));
    } catch (error) {
      if (isUniqueViolation(error)) {
        return err(
          conflictError(`User with email '${input.email}' already exists`, {
            resource: "User",
            conflictReason: "duplicate_email",
          }),
        );
      }

      return err(unexpectedError("Failed to create user", error));
    }
  },

  async update(
    id: string,
    input: UpdateUserInput,
  ): Promise<Result<User, UserRepositoryError>> {
    try {
      // Build update object with only provided fields
      const updateData: Partial<typeof users.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.name !== undefined) updateData.name = input.name;
      if (input.email !== undefined) updateData.email = input.email;
      if (input.image !== undefined) updateData.image = input.image;

      const result = await db
        .update(users)
        .set(updateData)
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .returning();

      const updated = result[0];

      if (!updated) {
        return err(notFoundError("User", id));
      }

      return ok(toUser(updated));
    } catch (error) {
      if (isUniqueViolation(error)) {
        return err(
          conflictError(`User with email '${input.email}' already exists`, {
            resource: "User",
            conflictReason: "duplicate_email",
          }),
        );
      }

      return err(unexpectedError("Failed to update user", error));
    }
  },

  async delete(id: string): Promise<Result<void, UserRepositoryError>> {
    try {
      const result = await db
        .update(users)
        .set({ deletedAt: new Date() })
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .returning({ id: users.id });

      if (result.length === 0) {
        return err(notFoundError("User", id));
      }

      return ok(undefined);
    } catch (error) {
      return err(unexpectedError("Failed to delete user", error));
    }
  },
});
