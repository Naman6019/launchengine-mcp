import { z } from "zod";
import { errorCodeSchema } from "./contracts/index.js";

/**
 * The API a published install talks to by default.
 *
 * Production, not localhost. This package is installed by *customers*, who are
 * not running the API — a localhost default meant `npx @launchengine-dev/mcp`
 * failed to connect for every one of them until they discovered and set an
 * environment variable they had no reason to know about. Local development sets
 * `LAUNCHENGINE_DEV_API_URL` explicitly, which is the correct direction for the
 * override to point.
 */
export const DEFAULT_API_BASE_URL = "https://launchengine.dev/api";

export const agentConfigSchema = z.object({
  apiBaseUrl: z
    .string()
    .url()
    .default(DEFAULT_API_BASE_URL)
    .describe("LaunchEngine.dev REST API base URL"),
  apiKey: z.string().min(1).optional(),
  /** Per-request timeout in milliseconds. */
  timeoutMs: z.number().int().positive().default(30_000),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

export class ToolCallError extends Error {
  constructor(
    public readonly code: z.infer<typeof errorCodeSchema>,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ToolCallError";
  }
}

export interface ApiClient {
  call<TInput, TOutput>(toolName: string, input: TInput): Promise<TOutput>;
}

interface SuccessEnvelope<T> {
  ok: true;
  data: T;
}
interface ErrorEnvelope {
  ok: false;
  error: { code: string; message: string; retryable?: boolean };
}

/**
 * REST client for the tool endpoint.
 *
 * Every response is the shared `{ ok, data | error }` envelope. Errors are
 * surfaced as ToolCallError with the contract's error code so the MCP layer can
 * return a typed payload rather than prose. A per-request timeout is set because
 * a hung upstream call would otherwise stall the agent indefinitely.
 */
export function createApiClient(config: AgentConfig): ApiClient {
  return {
    async call<TInput, TOutput>(
      toolName: string,
      input: TInput,
    ): Promise<TOutput> {
      if (!config.apiKey) {
        throw new ToolCallError(
          "UNAUTHORIZED_KEY",
          "LAUNCHENGINE_DEV_API_KEY is not set.",
        );
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);

      let res: Response;
      try {
        res = await fetch(
          `${config.apiBaseUrl}/tools/${encodeURIComponent(toolName)}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify(input),
            signal: controller.signal,
          },
        );
      } catch (err) {
        const aborted =
          err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
        throw new ToolCallError(
          "UPSTREAM_ERROR",
          aborted
            ? `Request to ${toolName} timed out after ${config.timeoutMs}ms.`
            : `Could not reach the LaunchEngine.dev API: ${
                err instanceof Error ? err.message : "unknown error"
              }`,
          true,
        );
      } finally {
        clearTimeout(timer);
      }

      let json: SuccessEnvelope<TOutput> | ErrorEnvelope;
      try {
        json = (await res.json()) as SuccessEnvelope<TOutput> | ErrorEnvelope;
      } catch {
        throw new ToolCallError(
          "UPSTREAM_ERROR",
          `API returned a non-JSON response (HTTP ${res.status}).`,
          res.status >= 500,
        );
      }

      if (!json.ok) {
        throw new ToolCallError(
          errorCodeSchema.catch("INTERNAL_ERROR").parse(json.error.code),
          json.error.message,
          json.error.retryable ?? false,
        );
      }

      return json.data;
    },
  };
}
