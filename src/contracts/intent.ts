import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common.js";

export const socialIntentSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  platform: z.enum(["reddit", "twitter", "hackernews"]),
  source_url: z.string().url(),
  content_hash: z.string(),
  post_title: z.string(),
  post_snippet: z.string(),
  author_handle: z.string().nullable(),
  matched_query: z.string().nullable(),
  posted_at: isoDateTimeSchema.nullable(),
  intent_score: z.number().int().min(1).max(100),
  classifier_version: z.string(),
  /**
   * Why the post scored what it did, e.g. "author states intent directly".
   *
   * Defaulted rather than required so a signal written before the column existed
   * still validates — an empty list means "not recorded", not "no signals".
   */
  reasons: z.array(z.string()).default([]),
  /**
   * Reply and vote counts at scan time. Nullable because the web-search
   * providers report neither, so null is "unknown" and 0 is genuinely "none".
   */
  comment_count: z.number().int().nullable().default(null),
  upvotes: z.number().int().nullable().default(null),
  suggested_reply: z.string().nullable(),
  status: z.enum(["new", "replied", "archived"]),
  discovered_at: isoDateTimeSchema,
});
export type SocialIntent = z.infer<typeof socialIntentSchema>;

/*
 * Field descriptions (`.describe()`) are part of the contract, not decoration:
 * they are what an MCP client shows the model and what a registry shows a
 * person, and without them every parameter is a bare name and a type. Each is
 * written for the caller — what to pass and what it changes — and goes last in
 * the chain so it sits on the outermost schema, where both the JSON Schema
 * conversion and the docs page read it.
 */
export const findIntentSignalsInputSchema = z.object({
  project_id: idSchema.describe("Project to search. Get ids from list_projects."),
  min_intent_score: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(60)
    .describe(
      "Lowest intent score to return, 1-100. 90+ is asking for exactly this now, 75-89 is comparing options, 60-74 is related; below 60 is mostly noise.",
    ),
  platforms: z
    .array(z.enum(["reddit", "twitter", "hackernews", "web"]))
    // "web" must be included by default: Tavily/Brave/Serper results are stored
    // with platform "web", so omitting it here would persist signals that the
    // read path can never return.
    .default(["hackernews", "reddit", "web"])
    .describe(
      'Sources to include. "web" is pages found through search indexes. "twitter" is accepted but not scanned yet, so it returns nothing.',
    ),
  since_days: z
    .number()
    .int()
    .min(1)
    .max(365)
    .default(30)
    .describe("Only posts from the last N days, 1-365."),
  status: z
    .enum(["new", "replied", "archived"])
    .optional()
    .describe("Only signals in this state. Omit for all states."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe(
      "Maximum signals to return, 1-100, highest score first. With scan: true it also caps results fetched per search query.",
    ),
  /**
   * When true, refresh from live sources before returning results. Adds latency
   * and upstream calls, so it is opt-in; a plain read only touches stored rows.
   */
  scan: z
    .boolean()
    .default(false)
    .describe(
      "Refresh from live sources before returning. Slower, and spends one of the workspace's daily scans (free plan: one a day across all projects) on top of the call's credit. Leave false to read signals found by earlier scans.",
    ),
  /**
   * How to use multiple configured web-search providers during a scan:
   *   "single"   — only the best free-tier provider (default; saves credits)
   *   "parallel" — query every configured provider, then merge and dedupe, so
   *                coverage is the union and each page appears once
   */
  web_mode: z
    .enum(["single", "parallel"])
    .default("single")
    .describe(
      'Only used with scan: true. "single" queries one web-search provider; "parallel" queries every configured provider and merges the results, for wider coverage at more upstream cost.',
    ),
  /**
   * Include signals whose author or subreddit the workspace has muted.
   *
   * Default false, so an agent sees the same list a human would — a mute that
   * only applied to the dashboard would be a mute that half works. Set true to
   * deliberately retrieve everything.
   */
  include_muted: z
    .boolean()
    .default(false)
    .describe(
      "Include posts from authors and subreddits the workspace has muted. Default false, matching the dashboard.",
    ),
});
export type FindIntentSignalsInput = z.infer<
  typeof findIntentSignalsInputSchema
>;

export const findIntentSignalsOutputSchema = z.object({
  signals: z.array(socialIntentSchema),
  scanned_at: isoDateTimeSchema,
  credits_consumed: z.number().int().nonnegative(),
});
export type FindIntentSignalsOutput = z.infer<
  typeof findIntentSignalsOutputSchema
>;

export const getIntentDetailsInputSchema = z.object({
  intent_id: idSchema.describe("Signal id, from find_intent_signals."),
});
export type GetIntentDetailsInput = z.infer<
  typeof getIntentDetailsInputSchema
>;

export const getIntentDetailsOutputSchema = z.object({
  signal: socialIntentSchema,
});
export type GetIntentDetailsOutput = z.infer<
  typeof getIntentDetailsOutputSchema
>;

export const draftReplyInputSchema = z.object({
  intent_id: idSchema.describe("Signal to reply to, from find_intent_signals."),
  tone: z
    .enum(["consultative", "direct", "technical"])
    .default("consultative")
    .describe(
      'Writing style: "consultative" (helpful, conversational), "direct" (gets to the point), or "technical" (practitioner detail). In every tone the draft helps with the problem and names no product, yours included.',
    ),
});
export type DraftReplyInput = z.infer<typeof draftReplyInputSchema>;

export const draftReplyOutputSchema = z.object({
  intent_id: idSchema,
  draft: z.string(),
  /** Always true for now: replies are assistive, a human posts them. */
  requires_human_post: z.literal(true),
  /**
   * Which path produced the draft. "template" when no LLM is configured or the
   * call failed, so a caller can tell a generic fallback from a real generation
   * rather than silently trusting the weaker output.
   */
  generated_by: z.enum(["template", "llm"]),
  /** Present when an LLM produced the draft, e.g. "openai/gpt-4o-mini". */
  model: z.string().optional(),
  credits_consumed: z.number().int().nonnegative(),
});
export type DraftReplyOutput = z.infer<typeof draftReplyOutputSchema>;

export const subscribeToKeywordInputSchema = z.object({
  project_id: idSchema.describe("Project to monitor for. Get ids from list_projects."),
  keyword: z
    .string()
    .min(2)
    .max(120)
    .describe(
      'Phrase to search for in every scan of this project, 2-120 characters, e.g. "alternative to Mixpanel". Subscribing the same keyword again updates it.',
    ),
  competitors: z
    .array(z.string().min(1))
    .max(25)
    .default([])
    // Honest about the current behaviour: scan-service.ts loads only the
    // subscription's keyword, and searches the project's own competitor list.
    .describe(
      "Competitor names to store with this keyword, up to 25; replaces the stored list. Scans currently search the project's own competitor list, not this one.",
    ),
});
export type SubscribeToKeywordInput = z.infer<
  typeof subscribeToKeywordInputSchema
>;

export const subscribeToKeywordOutputSchema = z.object({
  subscription_id: idSchema,
  active: z.boolean(),
});
export type SubscribeToKeywordOutput = z.infer<
  typeof subscribeToKeywordOutputSchema
>;
