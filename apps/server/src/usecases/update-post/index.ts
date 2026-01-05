/**
 * Public API for update-post usecase.
 * Re-exports schema, types, and usecase function.
 */

export {
  PatchPostInputSchema,
  PutPostInputSchema,
  parsePatchPostInput,
  parsePutPostInput,
} from "./input";
export type { PatchPostInput, PutPostInput } from "./input";

export { executePatchPost, executePutPost } from "./usecase";
export type {
  UpdatePostDeps,
  UpdatePostError,
  UpdatePostOutput,
} from "./usecase";
