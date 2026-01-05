/**
 * Input schema and validation for update-post usecase.
 * Uses zod for schema definition, returns Result for validation.
 */

import { type Result, err, ok } from "neverthrow";
import { z } from "zod";

import { type ValidationError, validationError } from "../../domain/errors";

/**
 * Base schema for partial update (PATCH).
 * All fields are optional.
 */
const UpdatePostFieldsSchema = z.object({
  title: z
    .string()
    .min(1, "title cannot be empty")
    .max(255, "title must be at most 255 characters")
    .optional(),
  content: z.string().min(1, "content cannot be empty").optional(),
});

/**
 * Input schema for partial update (PATCH).
 * At least one field must be provided.
 */
export const PatchPostInputSchema = z.object({
  id: z.string().min(1, "id is required"),
  userId: z.string().min(1, "userId is required"),
  data: UpdatePostFieldsSchema.refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  }),
});

/**
 * Input schema for full update (PUT).
 * All editable fields are required.
 */
export const PutPostInputSchema = z.object({
  id: z.string().min(1, "id is required"),
  userId: z.string().min(1, "userId is required"),
  data: z.object({
    title: z
      .string()
      .min(1, "title is required")
      .max(255, "title must be at most 255 characters"),
    content: z.string().min(1, "content is required"),
  }),
});

/**
 * Input type for partial update.
 */
export type PatchPostInput = z.infer<typeof PatchPostInputSchema>;

/**
 * Input type for full update.
 */
export type PutPostInput = z.infer<typeof PutPostInputSchema>;

/**
 * Parse and validate input data for partial update (PATCH).
 *
 * @param data - Raw input data to validate
 * @returns Result with validated input or ValidationError
 */
export const parsePatchPostInput = (
  data: unknown,
): Result<PatchPostInput, ValidationError> => {
  const result = PatchPostInputSchema.safeParse(data);

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));

    return err(validationError("Invalid patch-post input", { details }));
  }

  return ok(result.data);
};

/**
 * Parse and validate input data for full update (PUT).
 *
 * @param data - Raw input data to validate
 * @returns Result with validated input or ValidationError
 */
export const parsePutPostInput = (
  data: unknown,
): Result<PutPostInput, ValidationError> => {
  const result = PutPostInputSchema.safeParse(data);

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));

    return err(validationError("Invalid put-post input", { details }));
  }

  return ok(result.data);
};
