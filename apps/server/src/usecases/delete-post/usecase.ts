/**
 * Delete Post usecase.
 * Orchestrates domain services and repository calls to soft delete a post.
 */

import { type Result, err, ok } from "neverthrow";

import { unauthorizedError } from "../../domain/errors";
import type {
  NotFoundError,
  UnauthorizedError,
  UnexpectedError,
} from "../../domain/errors";
import type { PostAuthorizationService } from "../../domain/services";
import type { PostRepository } from "../../repositories/interfaces/post-repository";
import type { DeletePostInput } from "./input";

/**
 * Output of the delete-post usecase.
 */
export interface DeletePostOutput {
  readonly success: true;
}

/**
 * Dependencies required by the usecase.
 */
export interface DeletePostDeps {
  readonly postRepository: PostRepository;
  readonly postAuthorizationService: PostAuthorizationService;
}

/**
 * Usecase error.
 */
export type DeletePostError =
  | NotFoundError
  | UnauthorizedError
  | UnexpectedError;

/**
 * Execute the delete-post usecase.
 *
 * @param deps - Injected dependencies
 * @param input - Validated input data
 * @returns Result with output or error
 */
export const executeDeletePost = async (
  deps: DeletePostDeps,
  input: DeletePostInput,
): Promise<Result<DeletePostOutput, DeletePostError>> => {
  const { postRepository, postAuthorizationService } = deps;

  // Check authorization using domain service
  const authResult = await postAuthorizationService.canDeletePost(
    input.userId,
    input.id,
  );

  if (authResult.isErr()) {
    return err(authResult.error);
  }

  if (!authResult.value.isAuthorized) {
    return err(
      unauthorizedError(
        authResult.value.reason ?? "You are not authorized to delete this post",
      ),
    );
  }

  const result = await postRepository.delete(input.id);

  if (result.isErr()) {
    return err(result.error);
  }

  return ok({ success: true });
};
