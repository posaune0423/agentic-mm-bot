/**
 * Delete User usecase.
 * Soft deletes a user by setting deletedAt.
 */

import { type Result, err, ok } from "neverthrow";

import type {
  UserRepository,
  UserRepositoryError,
} from "../../repositories/interfaces/user-repository";
import type { DeleteUserInput } from "./input";

/**
 * Output of the delete-user usecase.
 */
export interface DeleteUserOutput {
  readonly success: true;
}

/**
 * Dependencies required by the usecase.
 */
export interface DeleteUserDeps {
  readonly userRepository: UserRepository;
}

/**
 * Usecase error.
 */
export type DeleteUserError = UserRepositoryError;

/**
 * Execute the delete-user usecase.
 *
 * @param deps - Injected dependencies
 * @param input - Validated input data
 * @returns Result with output or error
 */
export const executeDeleteUser = async (
  deps: DeleteUserDeps,
  input: DeleteUserInput,
): Promise<Result<DeleteUserOutput, DeleteUserError>> => {
  const { userRepository } = deps;

  const result = await userRepository.delete(input.id);

  if (result.isErr()) {
    return err(result.error);
  }

  return ok({ success: true });
};
