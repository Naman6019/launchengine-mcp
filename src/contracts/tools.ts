import { z } from "zod";
import {
  draftReplyInputSchema,
  draftReplyOutputSchema,
  findIntentSignalsInputSchema,
  findIntentSignalsOutputSchema,
  getIntentDetailsInputSchema,
  getIntentDetailsOutputSchema,
  subscribeToKeywordInputSchema,
  subscribeToKeywordOutputSchema,
} from "./intent.js";
import {
  listProjectsInputSchema,
  listProjectsOutputSchema,
} from "./project.js";
import { getCreditBalanceInputSchema, getCreditBalanceOutputSchema } from "./credits.js";

/**
 * A single tool definition is the source of truth for:
 *   - the MCP tool (name/description/inputSchema)
 *   - the REST/OpenAPI route (same schema)
 *   - the typed client contract
 *
 * Add a tool here first; MCP + API + UI derive from it.
 */
export interface ToolDescriptor<
  I extends z.ZodTypeAny = z.ZodTypeAny,
  O extends z.ZodTypeAny = z.ZodTypeAny,
> {
  name: string;
  /** Human-readable name, shown by MCP clients and registries. */
  title: string;
  description: string;
  input: I;
  output: O;
  /** Credits consumed per call (0 = free). Enforced server-side too. */
  creditCost: number;
  /** Required API-key scope. */
  scope: "read" | "write";
  /**
   * MCP tool annotations: hints a client uses to decide what to confirm with the
   * user. They are hints, not enforcement - the server checks scope and credits
   * on every call regardless.
   *
   * `readOnly` is stricter than `scope: "read"`: a metered call spends credits,
   * which changes the workspace, so it is never marked read-only even when its
   * key scope is "read". A client that auto-approves read-only tools must not
   * spend someone's credits without asking.
   */
  annotations: {
    readOnly: boolean;
    /** Deletes or irreversibly overwrites something. */
    destructive: boolean;
    /** Calling again with the same input has no further effect. */
    idempotent: boolean;
    /** Reaches outside the workspace (live web sources, a model provider). */
    openWorld: boolean;
  };
}

function defineTool<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  tool: ToolDescriptor<I, O>,
): ToolDescriptor<I, O> {
  return tool;
}

export const tools = {
  list_projects: defineTool({
    name: "list_projects",
    title: "List projects",
    description:
      "List the projects in the workspace: name, URL, description, target ICP and competitors. Free. Call this first - every other tool takes a project_id or a signal id that starts here.",
    input: listProjectsInputSchema,
    output: listProjectsOutputSchema,
    creditCost: 0,
    scope: "read",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
  }),

  get_credit_balance: defineTool({
    name: "get_credit_balance",
    title: "Get credit balance",
    description:
      "Return the workspace's credit balance and plan. Free; call it before a metered tool (find_intent_signals, draft_reply cost 1 credit each).",
    input: getCreditBalanceInputSchema,
    output: getCreditBalanceOutputSchema,
    creditCost: 0,
    scope: "read",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
  }),

  find_intent_signals: defineTool({
    name: "find_intent_signals",
    title: "Find intent signals",
    description:
      "Return scored posts from Reddit, Hacker News and the open web where someone is asking for a product like the project's - highest intent score (1-100) first, with the matched query and the reasons for the score. Reads signals found by earlier scans; pass scan: true to search live sources first. Costs 1 credit.",
    input: findIntentSignalsInputSchema,
    output: findIntentSignalsOutputSchema,
    creditCost: 1,
    scope: "read",
    annotations: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
  }),

  get_intent_details: defineTool({
    name: "get_intent_details",
    title: "Get signal details",
    description:
      "Fetch one signal by id: the post's title, snippet, URL, author, score, reasons, engagement and any saved draft reply. Free.",
    input: getIntentDetailsInputSchema,
    output: getIntentDetailsOutputSchema,
    creditCost: 0,
    scope: "read",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
  }),

  draft_reply: defineTool({
    name: "draft_reply",
    title: "Draft a reply",
    description:
      "Draft a reply to a signal's post for a person to review and post. Never posts anything. The draft helps with the poster's problem and names no product. Saved on the signal, replacing any earlier draft. Costs 1 credit.",
    input: draftReplyInputSchema,
    output: draftReplyOutputSchema,
    creditCost: 1,
    scope: "write",
    annotations: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
  }),

  subscribe_to_keyword: defineTool({
    name: "subscribe_to_keyword",
    title: "Monitor a keyword",
    description:
      "Add a keyword for a project's scans to search, or update one already added. A project with at least one keyword is included in the daily scheduled scan (06:00 UTC). Free.",
    input: subscribeToKeywordInputSchema,
    output: subscribeToKeywordOutputSchema,
    creditCost: 0,
    scope: "write",
    annotations: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
  }),
} as const;

export type ToolName = keyof typeof tools;
export const toolNames = Object.keys(tools) as ToolName[];
