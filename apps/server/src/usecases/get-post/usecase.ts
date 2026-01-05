/**
 * Get Post usecase.
 * Retrieves a single post by ID.
 */

import { type Result, err, ok } from "neverthrow";

import {
  type NotFoundError,
  notFoundError,
  type UnexpectedError,
} from "../../domain/errors";
import type {
  Post,
  PostRepository,
} from "../../repositories/interfaces/post-repository";
import type { GetPostInput } from "./input";

/**
 * Output of the get-post usecase.
 */
export interface GetPostOutput {
  readonly post: Post;
}

/**
 * Dependencies required by the usecase.
 */
export interface GetPostDeps {
  readonly postRepository: PostRepository;
}

/**
 * Usecase error.
 */
export type GetPostError = NotFoundError | UnexpectedError;

/**
 * Execute the get-post usecase.
 *
 * @param deps - Injected dependencies
 * @param input - Validated input data
 * @returns Result with output or error
 */
export const executeGetPost = async (
  deps: GetPostDeps,
  input: GetPostInput,
): Promise<Result<GetPostOutput, GetPostError>> => {
  const { postRepository } = deps;

  const result = await postRepository.findById(input.id);

  if (result.isErr()) {
    return err(result.error);
  }

  if (!result.value) {
    return err(notFoundError("Post", input.id));
  }

  return ok({ post: result.value });
};
