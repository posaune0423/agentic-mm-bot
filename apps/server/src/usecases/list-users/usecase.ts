/**
 * List Users usecase.
 * Retrieves paginated list of users.
 */

import { type Result, err, ok } from "neverthrow";

import type {
  User,
  UserRepository,
  UserRepositoryError,
} from "../../repositories/interfaces/user-repository";
import type { ListUsersInput } from "./input";

/**
 * Pagination info in response.
 */
export interface PaginationInfo {
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/**
 * Output of the list-users usecase.
 */
export interface ListUsersOutput {
  readonly users: readonly User[];
  readonly pagination: PaginationInfo;
}

/**
 * Dependencies required by the usecase.
 */
export interface ListUsersDeps {
  readonly userRepository: UserRepository;
}

/**
 * Usecase error.
 */
export type ListUsersError = UserRepositoryError;

/**
 * Execute the list-users usecase.
 *
 * @param deps - Injected dependencies
 * @param input - Validated input data
 * @returns Result with output or error
 */
export const executeListUsers = async (
  deps: ListUsersDeps,
  input: ListUsersInput,
): Promise<Result<ListUsersOutput, ListUsersError>> => {
  const { userRepository } = deps;

  const result = await userRepository.findAll({
    limit: input.limit,
    offset: input.offset,
  });

  if (result.isErr()) {
    return err(result.error);
  }

  return ok({
    users: result.value.users,
    pagination: {
      total: result.value.total,
      limit: input.limit,
      offset: input.offset,
    },
  });
};
