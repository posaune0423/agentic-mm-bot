/**
 * Input schema and validation for create-post usecase.
 * Uses zod for schema definition, returns Result for validation.
 */

import { type Result, err, ok } from "neverthrow";
import { z } from "zod";

import { type ValidationError, validationError } from "../../domain/errors";

/**
 * Input schema for creating a post.
 */
export const CreatePostInputSchema = z.object({
  title: z
    .string()
    .min(1, "title is required")
    .max(255, "title must be at most 255 characters"),
  content: z.string().min(1, "content is required"),
  authorId: z.string().min(1, "authorId is required"),
});

/**
 * Input type derived from schema.
 */
export type CreatePostInput = z.infer<typeof CreatePostInputSchema>;

/**
 * Parse and validate input data.
 * Returns Result instead of throwing.
 *
 * @param data - Raw input data to validate
 * @returns Result with validated input or ValidationError
 */
export const parseCreatePostInput = (
  data: unknown,
): Result<CreatePostInput, ValidationError> => {
  const result = CreatePostInputSchema.safeParse(data);

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));

    return err(validationError("Invalid create-post input", { details }));
  }

  return ok(result.data);
};
