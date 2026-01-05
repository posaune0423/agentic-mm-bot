/**
 * Input schema and validation for delete-user usecase.
 * Uses zod for schema definition, returns Result for validation.
 */

import { type Result, err, ok } from "neverthrow";
import { z } from "zod";

import { type ValidationError, validationError } from "../../domain/errors";

/**
 * Input schema for deleting a user.
 */
export const DeleteUserInputSchema = z.object({
  id: z.string().min(1, "id is required"),
});

/**
 * Input type derived from schema.
 */
export type DeleteUserInput = z.infer<typeof DeleteUserInputSchema>;

/**
 * Parse and validate input data.
 * Returns Result instead of throwing.
 *
 * @param data - Raw input data to validate
 * @returns Result with validated input or ValidationError
 */
export const parseDeleteUserInput = (
  data: unknown,
): Result<DeleteUserInput, ValidationError> => {
  const result = DeleteUserInputSchema.safeParse(data);

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));

    return err(validationError("Invalid delete-user input", { details }));
  }

  return ok(result.data);
};
