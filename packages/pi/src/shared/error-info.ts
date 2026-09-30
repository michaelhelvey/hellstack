import { z } from "zod";

const ErrorInfoSchema = z
  .object({
    code: z.union([z.string(), z.number()]).optional().catch(undefined),
    message: z.string().optional().catch(undefined),
    stderr: z.string().optional().catch(undefined),
  })
  .catch({});

/** The fields of a thrown value that the extensions use. All fields are optional. */
export type ErrorInfo = z.infer<typeof ErrorInfoSchema>;

/** Reads the `code`, `message`, and `stderr` fields from a thrown value of unknown type. */
export function parseErrorInfo(error: unknown): ErrorInfo {
  return ErrorInfoSchema.parse(error);
}
