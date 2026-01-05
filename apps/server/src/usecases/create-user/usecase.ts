/**
 * Create User usecase.
 * Orchestrates domain services and repository calls.
 */

import { type Result, err, ok } from "neverthrow";

import { conflictError } from "../../domain/errors";
import type {
  ConflictError,
  NotFoundError,
  UnexpectedError,
  ValidationError,
} from "../../domain/errors";
import type { UserAuthenticationService } from "../../domain/services";
import type {
  User,
  UserRepository,
} from "../../repositories/interfaces/user-repository";
import type { CreateUserInput } from "./input";

/**
 * Output of the create-user usecase.
 */
export interface CreateUserOutput {
  readonly user: User;
}

/**
 * Dependencies required by the usecase.
 * Injected for testability (no hard dependencies on infra).
 */
export interface CreateUserDeps {
  readonly userRepository: UserRepository;
  readonly userAuthenticationService: UserAuthenticationService;
}

/**
 * Usecase error - combines domain errors with repository errors.
 */
export type CreateUserError =
  | ConflictError
  | NotFoundError
  | UnexpectedError
  | ValidationError;

/**
 * Execute the create-user usecase.
 *
 * @param deps - Injected dependencies (repositories, services, etc.)
 * @param input - Validated input data
 * @returns Result with output or error
 */
export const executeCreateUser = async (
  deps: CreateUserDeps,
  input: CreateUserInput,
): Promise<Result<CreateUserOutput, CreateUserError>> => {
  const { userRepository, userAuthenticationService } = deps;

  // Check if email is available using domain service
  const availabilityResult = await userAuthenticationService.isEmailAvailable(
    input.email,
  );

  if (availabilityResult.isErr()) {
    return err(availabilityResult.error);
  }

  if (!availabilityResult.value) {
    return err(
      conflictError(`User with email '${input.email}' already exists`, {
        resource: "User",
        conflictReason: "duplicate_email",
      }),
    );
  }

  // Create the user
  const createResult = await userRepository.create({
    name: input.name,
    email: input.email,
    image: input.image,
  });

  if (createResult.isErr()) {
    return err(createResult.error);
  }

  return ok({ user: createResult.value });
};
