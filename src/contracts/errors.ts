import { z } from "zod";

/**
 * Typed, machine-readable error codes. Agents branch on these; never parse prose.
 */
export const errorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "UNAUTHORIZED_KEY",
  "FORBIDDEN_SCOPE",
  "INSUFFICIENT_CREDITS",
  "RATE_LIMITED",
  "NOT_FOUND",
  "SUPPRESSED_RECIPIENT",
  "IDEMPOTENT_REPLAY",
  "CONFLICT",
  "UPSTREAM_ERROR",
  "INTERNAL_ERROR",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const apiErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  retryable: z.boolean().default(false),
  /** Present for RATE_LIMITED / INSUFFICIENT_CREDITS so agents can back off correctly. */
  retry_after_seconds: z.number().int().positive().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const apiResultSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data }),
    z.object({ ok: z.literal(false), error: apiErrorSchema }),
  ]);

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };
