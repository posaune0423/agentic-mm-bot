/**
 * List Posts usecase.
 * Retrieves paginated list of posts.
 */

import { type Result, err, ok } from "neverthrow";

import type {
  Post,
  PostRepository,
  PostRepositoryError,
} from "../../repositories/interfaces/post-repository";
import type { ListPostsInput } from "./input";

/**
 * Pagination info in response.
 */
export interface PaginationInfo {
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/**
 * Output of the list-posts usecase.
 */
export interface ListPostsOutput {
  readonly posts: readonly Post[];
  readonly pagination: PaginationInfo;
}

/**
 * Dependencies required by the usecase.
 */
export interface ListPostsDeps {
  readonly postRepository: PostRepository;
}

/**
 * Usecase error.
 */
export type ListPostsError = PostRepositoryError;

/**
 * Execute the list-posts usecase.
 *
 * @param deps - Injected dependencies
 * @param input - Validated input data
 * @returns Result with output or error
 */
export const executeListPosts = async (
  deps: ListPostsDeps,
  input: ListPostsInput,
): Promise<Result<ListPostsOutput, ListPostsError>> => {
  const { postRepository } = deps;

  const result = await postRepository.findAll({
    limit: input.limit,
    offset: input.offset,
    authorId: input.authorId,
  });

  if (result.isErr()) {
    return err(result.error);
  }

  return ok({
    posts: result.value.posts,
    pagination: {
      total: result.value.total,
      limit: input.limit,
      offset: input.offset,
    },
  });
};
