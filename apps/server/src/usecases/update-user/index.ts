/**
 * Public API for update-user usecase.
 * Re-exports schema, types, and usecase function.
 */

export {
  PatchUserInputSchema,
  PutUserInputSchema,
  parsePatchUserInput,
  parsePutUserInput,
} from "./input";
export type { PatchUserInput, PutUserInput } from "./input";

export { executePatchUser, executePutUser } from "./usecase";
export type {
  UpdateUserDeps,
  UpdateUserError,
  UpdateUserOutput,
} from "./usecase";
