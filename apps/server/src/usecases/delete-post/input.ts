/**
 * Input schema and validation for delete-post usecase.
 * Uses zod for schema definition, returns Result for validation.
 */

import { type Result, err, ok } from "neverthrow";
import { z } from "zod";

import { type ValidationError, validationError } from "../../domain/errors";

/**
 * Input schema for deleting a post.
 */
export const DeletePostInputSchema = z.object({
  id: z.string().min(1, "id is required"),
  userId: z.string().min(1, "userId is required"),
});

/**
 * Input type derived from schema.
 */
export type DeletePostInput = z.infer<typeof DeletePostInputSchema>;

/**
 * Parse and validate input data.
 * Returns Result instead of throwing.
 *
 * @param data - Raw input data to validate
 * @returns Result with validated input or ValidationError
 */
export const parseDeletePostInput = (
  data: unknown,
): Result<DeletePostInput, ValidationError> => {
  const result = DeletePostInputSchema.safeParse(data);

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));

    return err(validationError("Invalid delete-post input", { details }));
  }

  return ok(result.data);
};
