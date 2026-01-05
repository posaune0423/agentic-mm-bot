/**
 * Input schema and validation for update-user usecase.
 * Uses zod for schema definition, returns Result for validation.
 */

import { type Result, err, ok } from "neverthrow";
import { z } from "zod";

import { type ValidationError, validationError } from "../../domain/errors";

/**
 * Base schema for partial update (PATCH).
 * All fields are optional.
 */
const UpdateUserFieldsSchema = z.object({
  name: z
    .string()
    .min(1, "name cannot be empty")
    .max(255, "name must be at most 255 characters")
    .optional(),
  email: z.email("email must be a valid email address").optional(),
  image: z.url("image must be a valid URL").max(255).optional().nullable(),
});

/**
 * Input schema for partial update (PATCH).
 * At least one field must be provided.
 */
export const PatchUserInputSchema = z.object({
  id: z.string().min(1, "id is required"),
  data: UpdateUserFieldsSchema.refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  }),
});

/**
 * Input schema for full update (PUT).
 * All editable fields are required.
 */
export const PutUserInputSchema = z.object({
  id: z.string().min(1, "id is required"),
  data: z.object({
    name: z
      .string()
      .min(1, "name is required")
      .max(255, "name must be at most 255 characters"),
    email: z.email("email must be a valid email address"),
    image: z.url("image must be a valid URL").max(255).optional().nullable(),
  }),
});

/**
 * Input type for partial update.
 */
export type PatchUserInput = z.infer<typeof PatchUserInputSchema>;

/**
 * Input type for full update.
 */
export type PutUserInput = z.infer<typeof PutUserInputSchema>;

/**
 * Parse and validate input data for partial update (PATCH).
 *
 * @param data - Raw input data to validate
 * @returns Result with validated input or ValidationError
 */
export const parsePatchUserInput = (
  data: unknown,
): Result<PatchUserInput, ValidationError> => {
  const result = PatchUserInputSchema.safeParse(data);

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));

    return err(validationError("Invalid patch-user input", { details }));
  }

  return ok(result.data);
};

/**
 * Parse and validate input data for full update (PUT).
 *
 * @param data - Raw input data to validate
 * @returns Result with validated input or ValidationError
 */
export const parsePutUserInput = (
  data: unknown,
): Result<PutUserInput, ValidationError> => {
  const result = PutUserInputSchema.safeParse(data);

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));

    return err(validationError("Invalid put-user input", { details }));
  }

  return ok(result.data);
};
