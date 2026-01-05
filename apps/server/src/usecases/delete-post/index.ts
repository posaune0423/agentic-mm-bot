/**
 * Public API for delete-post usecase.
 * Re-exports schema, types, and usecase function.
 */

export { DeletePostInputSchema, parseDeletePostInput } from "./input";
export type { DeletePostInput } from "./input";

export { executeDeletePost } from "./usecase";
export type {
  DeletePostDeps,
  DeletePostError,
  DeletePostOutput,
} from "./usecase";
