/**
 * Update Post usecase.
 * Orchestrates domain services and repository calls.
 */

import { type Result, err, ok } from "neverthrow";

import { unauthorizedError } from "../../domain/errors";
import type {
  NotFoundError,
  UnauthorizedError,
  UnexpectedError,
} from "../../domain/errors";
import type { PostAuthorizationService } from "../../domain/services";
import type {
  Post,
  PostRepository,
} from "../../repositories/interfaces/post-repository";
import type { PatchPostInput, PutPostInput } from "./input";

/**
 * Output of the update-post usecase.
 */
export interface UpdatePostOutput {
  readonly post: Post;
}

/**
 * Dependencies required by the usecase.
 */
export interface UpdatePostDeps {
  readonly postRepository: PostRepository;
  readonly postAuthorizationService: PostAuthorizationService;
}

/**
 * Usecase error.
 */
export type UpdatePostError =
  | NotFoundError
  | UnauthorizedError
  | UnexpectedError;

/**
 * Execute the update-post usecase for partial update (PATCH).
 *
 * @param deps - Injected dependencies
 * @param input - Validated input data
 * @returns Result with output or error
 */
export const executePatchPost = async (
  deps: UpdatePostDeps,
  input: PatchPostInput,
): Promise<Result<UpdatePostOutput, UpdatePostError>> => {
  const { postRepository, postAuthorizationService } = deps;

  // Check authorization using domain service
  const authResult = await postAuthorizationService.canEditPost(
    input.userId,
    input.id,
  );

  if (authResult.isErr()) {
    return err(authResult.error);
  }

  if (!authResult.value.isAuthorized) {
    return err(
      unauthorizedError(
        authResult.value.reason ?? "You are not authorized to edit this post",
      ),
    );
  }

  const result = await postRepository.update(input.id, input.data);

  if (result.isErr()) {
    return err(result.error);
  }

  return ok({ post: result.value });
};

/**
 * Execute the update-post usecase for full update (PUT).
 *
 * @param deps - Injected dependencies
 * @param input - Validated input data
 * @returns Result with output or error
 */
export const executePutPost = async (
  deps: UpdatePostDeps,
  input: PutPostInput,
): Promise<Result<UpdatePostOutput, UpdatePostError>> => {
  const { postRepository, postAuthorizationService } = deps;

  // Check authorization using domain service
  const authResult = await postAuthorizationService.canEditPost(
    input.userId,
    input.id,
  );

  if (authResult.isErr()) {
    return err(authResult.error);
  }

  if (!authResult.value.isAuthorized) {
    return err(
      unauthorizedError(
        authResult.value.reason ?? "You are not authorized to edit this post",
      ),
    );
  }

  const result = await postRepository.update(input.id, input.data);

  if (result.isErr()) {
    return err(result.error);
  }

  return ok({ post: result.value });
};
