/**
 * Input schema and validation for list-posts usecase.
 * Uses zod for schema definition, returns Result for validation.
 */

import { type Result, err, ok } from "neverthrow";
import { z } from "zod";

import { type ValidationError, validationError } from "../../domain/errors";

/**
 * Input schema for listing posts.
 */
export const ListPostsInputSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  authorId: z.string().optional(),
});

/**
 * Input type derived from schema.
 */
export type ListPostsInput = z.infer<typeof ListPostsInputSchema>;

/**
 * Parse and validate input data.
 * Returns Result instead of throwing.
 *
 * @param data - Raw input data to validate
 * @returns Result with validated input or ValidationError
 */
export const parseListPostsInput = (
  data: unknown,
): Result<ListPostsInput, ValidationError> => {
  const result = ListPostsInputSchema.safeParse(data);

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));

    return err(validationError("Invalid list-posts input", { details }));
  }

  return ok(result.data);
};
