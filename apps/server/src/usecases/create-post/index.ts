/**
 * Public API for create-post usecase.
 * Re-exports schema, types, and usecase function.
 */

export { CreatePostInputSchema, parseCreatePostInput } from "./input";
export type { CreatePostInput } from "./input";

export { executeCreatePost } from "./usecase";
export type {
  CreatePostDeps,
  CreatePostError,
  CreatePostOutput,
} from "./usecase";
