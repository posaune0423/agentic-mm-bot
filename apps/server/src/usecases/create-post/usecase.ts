/**
 * Create Post usecase.
 * Orchestrates repository calls and domain logic.
 */

import { type Result, err, ok } from "neverthrow";

import { notFoundError } from "../../domain/errors";
import type {
  ConflictError,
  NotFoundError,
  UnexpectedError,
} from "../../domain/errors";
import type {
  Post,
  PostRepository,
} from "../../repositories/interfaces/post-repository";
import type { UserRepository } from "../../repositories/interfaces/user-repository";
import type { CreatePostInput } from "./input";

/**
 * Output of the create-post usecase.
 */
export interface CreatePostOutput {
  readonly post: Post;
}

/**
 * Dependencies required by the usecase.
 * Injected for testability (no hard dependencies on infra).
 */
export interface CreatePostDeps {
  readonly postRepository: PostRepository;
  readonly userRepository: UserRepository;
}

/**
 * Usecase error - combines domain errors with repository errors.
 */
export type CreatePostError = NotFoundError | ConflictError | UnexpectedError;

/**
 * Execute the create-post usecase.
 *
 * @param deps - Injected dependencies (repositories, etc.)
 * @param input - Validated input data
 * @returns Result with output or error
 */
export const executeCreatePost = async (
  deps: CreatePostDeps,
  input: CreatePostInput,
): Promise<Result<CreatePostOutput, CreatePostError>> => {
  const { postRepository, userRepository } = deps;

  // Verify author exists
  const authorResult = await userRepository.findById(input.authorId);

  if (authorResult.isErr()) {
    return err(authorResult.error);
  }

  if (!authorResult.value) {
    return err(notFoundError("User", input.authorId));
  }

  // Create the post
  const createResult = await postRepository.create({
    title: input.title,
    content: input.content,
    authorId: input.authorId,
  });

  if (createResult.isErr()) {
    return err(createResult.error);
  }

  return ok({ post: createResult.value });
};
