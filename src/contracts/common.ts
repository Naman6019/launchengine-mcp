import { z } from "zod";

export const idSchema = z.string().uuid();
export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const paginationSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
export type Pagination = z.infer<typeof paginationSchema>;

export const pageSchema = z.object({
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
});
export type Page = z.infer<typeof pageSchema>;

export const intentPlatformSchema = z.enum(["reddit", "twitter", "hackernews"]);
export type IntentPlatform = z.infer<typeof intentPlatformSchema>;

export const intentStatusSchema = z.enum(["new", "replied", "archived"]);
export type IntentStatus = z.infer<typeof intentStatusSchema>;

export const emailStatusSchema = z.enum([
  "verified",
  "catch_all",
  "risky",
  "unknown",
  "unverified",
]);
export type EmailStatus = z.infer<typeof emailStatusSchema>;

export const jobKindSchema = z.enum([
  "scan_social_intent",
  "draft_reply",
  "enrich_leads",
  "generate_comparison",
]);
export type JobKind = z.infer<typeof jobKindSchema>;

export const jobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "dead",
]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const planTypeSchema = z.enum([
  "free_trial",
  "radar",
  "radar_byok",
  "launch_pass",
]);
export type PlanType = z.infer<typeof planTypeSchema>;

export const creditKindSchema = z.enum([
  "grant",
  "reserve",
  "refund",
  "purchase",
  "expire",
]);
export type CreditKind = z.infer<typeof creditKindSchema>;
