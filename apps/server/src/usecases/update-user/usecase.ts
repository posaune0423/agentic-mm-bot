/**
 * Update User usecase.
 * Updates an existing user.
 */

import { type Result, err, ok } from "neverthrow";

import type {
  ConflictError,
  NotFoundError,
  UnexpectedError,
} from "../../domain/errors";
import type {
  User,
  UserRepository,
} from "../../repositories/interfaces/user-repository";
import type { PatchUserInput, PutUserInput } from "./input";

/**
 * Output of the update-user usecase.
 */
export interface UpdateUserOutput {
  readonly user: User;
}

/**
 * Dependencies required by the usecase.
 */
export interface UpdateUserDeps {
  readonly userRepository: UserRepository;
}

/**
 * Usecase error.
 */
export type UpdateUserError = NotFoundError | ConflictError | UnexpectedError;

/**
 * Execute the update-user usecase for partial update (PATCH).
 *
 * @param deps - Injected dependencies
 * @param input - Validated input data
 * @returns Result with output or error
 */
export const executePatchUser = async (
  deps: UpdateUserDeps,
  input: PatchUserInput,
): Promise<Result<UpdateUserOutput, UpdateUserError>> => {
  const { userRepository } = deps;

  const result = await userRepository.update(input.id, input.data);

  if (result.isErr()) {
    return err(result.error);
  }

  return ok({ user: result.value });
};

/**
 * Execute the update-user usecase for full update (PUT).
 *
 * @param deps - Injected dependencies
 * @param input - Validated input data
 * @returns Result with output or error
 */
export const executePutUser = async (
  deps: UpdateUserDeps,
  input: PutUserInput,
): Promise<Result<UpdateUserOutput, UpdateUserError>> => {
  const { userRepository } = deps;

  const result = await userRepository.update(input.id, input.data);

  if (result.isErr()) {
    return err(result.error);
  }

  return ok({ user: result.value });
};
