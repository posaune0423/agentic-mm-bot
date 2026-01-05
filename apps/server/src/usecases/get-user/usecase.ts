/**
 * Get User usecase.
 * Retrieves a single user by ID.
 */

import { type Result, err, ok } from "neverthrow";

import { notFoundError } from "../../domain/errors";
import type {
  User,
  UserRepository,
  UserRepositoryError,
} from "../../repositories/interfaces/user-repository";
import type { GetUserInput } from "./input";

/**
 * Output of the get-user usecase.
 */
export interface GetUserOutput {
  readonly user: User;
}

/**
 * Dependencies required by the usecase.
 */
export interface GetUserDeps {
  readonly userRepository: UserRepository;
}

/**
 * Usecase error.
 */
export type GetUserError = UserRepositoryError;

/**
 * Execute the get-user usecase.
 *
 * @param deps - Injected dependencies
 * @param input - Validated input data
 * @returns Result with output or error
 */
export const executeGetUser = async (
  deps: GetUserDeps,
  input: GetUserInput,
): Promise<Result<GetUserOutput, GetUserError>> => {
  const { userRepository } = deps;

  const result = await userRepository.findById(input.id);

  if (result.isErr()) {
    return err(result.error);
  }

  if (!result.value) {
    return err(notFoundError("User", input.id));
  }

  return ok({ user: result.value });
};
