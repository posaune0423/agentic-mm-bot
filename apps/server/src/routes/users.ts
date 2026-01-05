/**
 * User routes - HTTP endpoints for user operations.
 */

import { Hono } from "hono";

import type { UserAuthenticationService } from "../domain/services/user-authentication-service";
import type { UserRepository } from "../repositories/interfaces/user-repository";
import {
  executeCreateUser,
  parseCreateUserInput,
} from "../usecases/create-user";
import {
  executeDeleteUser,
  parseDeleteUserInput,
} from "../usecases/delete-user";
import { executeGetUser, parseGetUserInput } from "../usecases/get-user";
import { executeListUsers, parseListUsersInput } from "../usecases/list-users";
import {
  executePatchUser,
  executePutUser,
  parsePatchUserInput,
  parsePutUserInput,
} from "../usecases/update-user";
import { sendHttpError } from "../utils/http-error";

/**
 * Dependencies for user routes.
 */
export interface UserRoutesDeps {
  readonly userRepository: UserRepository;
  readonly userAuthenticationService: UserAuthenticationService;
}

/**
 * Create user routes with injected dependencies.
 * DI allows testing without mock.module().
 */
export const createUserRoutes = (deps: UserRoutesDeps) => {
  const users = new Hono();

  /**
   * GET /users
   * List all users with pagination.
   */
  users.get("/", async (c) => {
    const query = c.req.query();

    const inputResult = parseListUsersInput(query);

    if (inputResult.isErr()) {
      return sendHttpError(c, inputResult.error);
    }

    const result = await executeListUsers(
      { userRepository: deps.userRepository },
      inputResult.value,
    );

    if (result.isErr()) {
      return sendHttpError(c, result.error);
    }

    return c.json({
      data: result.value.users,
      pagination: result.value.pagination,
    });
  });

  /**
   * GET /users/:id
   * Get a single user by ID.
   */
  users.get("/:id", async (c) => {
    const inputResult = parseGetUserInput({ id: c.req.param("id") });

    if (inputResult.isErr()) {
      return sendHttpError(c, inputResult.error);
    }

    const result = await executeGetUser(
      { userRepository: deps.userRepository },
      inputResult.value,
    );

    if (result.isErr()) {
      return sendHttpError(c, result.error);
    }

    return c.json({ data: result.value.user });
  });

  /**
   * POST /users
   * Create a new user.
   */
  users.post("/", async (c) => {
    const body = await c.req.json();

    const inputResult = parseCreateUserInput(body);

    if (inputResult.isErr()) {
      return sendHttpError(c, inputResult.error);
    }

    const result = await executeCreateUser(
      {
        userRepository: deps.userRepository,
        userAuthenticationService: deps.userAuthenticationService,
      },
      inputResult.value,
    );

    if (result.isErr()) {
      return sendHttpError(c, result.error);
    }

    return c.json({ data: result.value.user }, 201);
  });

  /**
   * PUT /users/:id
   * Full update of a user.
   */
  users.put("/:id", async (c) => {
    const body = await c.req.json();

    const inputResult = parsePutUserInput({
      id: c.req.param("id"),
      data: body,
    });

    if (inputResult.isErr()) {
      return sendHttpError(c, inputResult.error);
    }

    const result = await executePutUser(
      { userRepository: deps.userRepository },
      inputResult.value,
    );

    if (result.isErr()) {
      return sendHttpError(c, result.error);
    }

    return c.json({ data: result.value.user });
  });

  /**
   * PATCH /users/:id
   * Partial update of a user.
   */
  users.patch("/:id", async (c) => {
    const body = await c.req.json();

    const inputResult = parsePatchUserInput({
      id: c.req.param("id"),
      data: body,
    });

    if (inputResult.isErr()) {
      return sendHttpError(c, inputResult.error);
    }

    const result = await executePatchUser(
      { userRepository: deps.userRepository },
      inputResult.value,
    );

    if (result.isErr()) {
      return sendHttpError(c, result.error);
    }

    return c.json({ data: result.value.user });
  });

  /**
   * DELETE /users/:id
   * Soft delete a user.
   */
  users.delete("/:id", async (c) => {
    const inputResult = parseDeleteUserInput({ id: c.req.param("id") });

    if (inputResult.isErr()) {
      return sendHttpError(c, inputResult.error);
    }

    const result = await executeDeleteUser(
      { userRepository: deps.userRepository },
      inputResult.value,
    );

    if (result.isErr()) {
      return sendHttpError(c, result.error);
    }

    return c.body(null, 204);
  });

  return users;
};
