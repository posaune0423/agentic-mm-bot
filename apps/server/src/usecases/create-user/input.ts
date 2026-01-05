/**
 * Input schema and validation for create-user usecase.
 * Uses zod for schema definition, returns Result for validation.
 */

import { type Result, err, ok } from "neverthrow";
import { z } from "zod";

import { type ValidationError, validationError } from "../../domain/errors";

/**
 * Input schema for creating a user.
 */
export const CreateUserInputSchema = z.object({
  name: z
    .string()
    .min(1, "name is required")
    .max(255, "name must be at most 255 characters"),
  email: z.email("email must be a valid email address"),
  image: z.url("image must be a valid URL").max(255).optional().nullable(),
});

/**
 * Input type derived from schema.
 */
export type CreateUserInput = z.infer<typeof CreateUserInputSchema>;

/**
 * Parse and validate input data.
 * Returns Result instead of throwing.
 *
 * @param data - Raw input data to validate
 * @returns Result with validated input or ValidationError
 */
export const parseCreateUserInput = (
  data: unknown,
): Result<CreateUserInput, ValidationError> => {
  const result = CreateUserInputSchema.safeParse(data);

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));

    return err(validationError("Invalid create-user input", { details }));
  }

  return ok(result.data);
};
