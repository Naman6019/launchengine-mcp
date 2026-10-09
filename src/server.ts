import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { toolNames, tools } from "./contracts/index.js";
import { agentConfigSchema, createApiClient, ToolCallError } from "./client.js";

/**
 * The version reported in the MCP handshake.
 *
 * Injected at bundle time from `package.json`, so the version a client sees is
 * always the version npm published — one source, no drift. Two places holding a
 * version string is how they end up disagreeing, and this codebase has already
 * been bitten by that pattern twice.
 *
 * `typeof` guards the injection: esbuild replaces the identifier with a string
 * literal when bundling, and under `tsx` during development it is simply
 * undefined. `typeof` on an undeclared identifier is safe and does not throw,
 * which is what makes the same source work in both modes.
 */
declare const __MCP_VERSION__: string;
const VERSION = typeof __MCP_VERSION__ === "string" ? __MCP_VERSION__ : "dev";

/**
 * Sent to the client in the `initialize` result; clients that support it put
 * this in the model's context once, before any tool is called.
 *
 * It carries what no single tool description can: the order to call things in,
 * what costs credits, and that nothing is ever posted. Kept short, because it is
 * read on every session whether or not a tool is used.
 */
export const INSTRUCTIONS = `LaunchEngine.dev finds public posts (Reddit, Hacker News, the open web) where someone is asking for a product like the user's, scores each 1-100 for buying intent, and drafts replies for a person to post.

Typical flow: list_projects -> find_intent_signals (project_id) -> get_intent_details or draft_reply (intent_id).

Costs: find_intent_signals and draft_reply cost 1 credit each; everything else is free. Check get_credit_balance before a batch. find_intent_signals with scan: true also uses the workspace's daily scan allowance, so prefer reading stored signals.

Nothing is ever posted. Show drafts to the user to edit and post themselves; automated self-promotion is treated as spam by Reddit and Hacker News.`;

/**
 * The MCP server is generated from the shared contract registry, so a tool is
 * defined once (packages/contracts) and appears identically in MCP, REST, and UI.
 */
export function buildServer(config: ReturnType<typeof agentConfigSchema.parse>) {
  const server = new McpServer(
    {
      name: "launchengine-dev",
      title: "LaunchEngine.dev",
      version: VERSION,
      websiteUrl: "https://launchengine.dev/docs/agents",
    },
    { instructions: INSTRUCTIONS },
  );

  const api = createApiClient(config);

  for (const name of toolNames) {
    const tool = tools[name];

    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input.shape,
        // Hints for the client's confirmation UI; the server enforces scope and
        // credits on every call regardless (see ToolDescriptor.annotations).
        annotations: {
          title: tool.title,
          readOnlyHint: tool.annotations.readOnly,
          destructiveHint: tool.annotations.destructive,
          idempotentHint: tool.annotations.idempotent,
          openWorldHint: tool.annotations.openWorld,
        },
      },
      async (args: unknown) => {
        const parsed = tool.input.safeParse(args);
        if (!parsed.success) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  code: "VALIDATION_ERROR",
                  message: parsed.error.issues
                    .map((i) => `${i.path.join(".")}: ${i.message}`)
                    .join("; "),
                  retryable: false,
                }),
              },
            ],
          };
        }

        try {
          const data = await api.call<unknown, unknown>(
            tool.name,
            parsed.data,
          );
          const validated = tool.output.safeParse(data);
          const payload = validated.success ? validated.data : data;
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(payload, null, 2) },
            ],
          };
        } catch (err) {
          if (err instanceof ToolCallError) {
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    code: err.code,
                    message: err.message,
                    retryable: err.retryable,
                  }),
                },
              ],
            };
          }
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  code: "INTERNAL_ERROR",
                  message:
                    err instanceof Error ? err.message : "Unknown error",
                  retryable: false,
                }),
              },
            ],
          };
        }
      },
    );
  }

  return server;
}

export async function start(config: ReturnType<typeof agentConfigSchema.parse>) {
  const server = buildServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
