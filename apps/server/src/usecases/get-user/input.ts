/**
 * Input schema and validation for get-user usecase.
 * Uses zod for schema definition, returns Result for validation.
 */

import { type Result, err, ok } from "neverthrow";
import { z } from "zod";

import { type ValidationError, validationError } from "../../domain/errors";

/**
 * Input schema for getting a user.
 */
export const GetUserInputSchema = z.object({
  id: z.string().min(1, "id is required"),
});

/**
 * Input type derived from schema.
 */
export type GetUserInput = z.infer<typeof GetUserInputSchema>;

/**
 * Parse and validate input data.
 * Returns Result instead of throwing.
 *
 * @param data - Raw input data to validate
 * @returns Result with validated input or ValidationError
 */
export const parseGetUserInput = (
  data: unknown,
): Result<GetUserInput, ValidationError> => {
  const result = GetUserInputSchema.safeParse(data);

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));

    return err(validationError("Invalid get-user input", { details }));
  }

  return ok(result.data);
};
