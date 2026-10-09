import { agentConfigSchema, DEFAULT_API_BASE_URL } from "./client.js";
import { start } from "./server.js";

/**
 * MCP server entry point.
 *
 * ## Why this prints a startup line
 *
 * An MCP server over stdio produces **no output on launch** — it starts, then
 * waits for JSON-RPC on stdin. That is correct, but it is indistinguishable from
 * a hang, a crash, or a failed install: in every one of those cases the terminal
 * also shows nothing and returns to a prompt-shaped void.
 *
 * So a single line goes to **stderr**, which is where MCP diagnostics belong —
 * stdout is the protocol channel, and anything written there would corrupt the
 * JSON-RPC stream and break the client. This is the difference between "it is
 * working" and "I have no idea".
 *
 * ## `--help` and `--version`
 *
 * Without these, `npx @launchengine-dev/mcp --help` waits forever, because the
 * arguments are ignored and the server simply starts. Someone checking whether
 * the install worked would conclude it is broken. Both exit immediately.
 */

const HELP = `launchengine-dev-mcp — MCP server for LaunchEngine.dev

This is a stdio MCP server. It is normally launched by an MCP client, not by
hand; running it directly will start the server and wait for JSON-RPC on stdin,
which is why nothing appears to happen.

Usage:
  launchengine-dev-mcp            start the server (stdio)
  launchengine-dev-mcp --help     show this text
  launchengine-dev-mcp --version  print the version

Environment:
  LAUNCHENGINE_DEV_API_KEY   required. Your workspace key, le_live_...
  LAUNCHENGINE_DEV_API_URL   optional. Defaults to ${DEFAULT_API_BASE_URL}

Claude Desktop (claude_desktop_config.json):
  {
    "mcpServers": {
      "launchengine": {
        "command": "npx",
        "args": ["-y", "@launchengine-dev/mcp"],
        "env": { "LAUNCHENGINE_DEV_API_KEY": "le_live_..." }
      }
    }
  }

Claude Code:
  claude mcp add launchengine \\
    --env LAUNCHENGINE_DEV_API_KEY=le_live_... \\
    -- npx -y @launchengine-dev/mcp

Docs: https://launchengine.dev/docs/agents
`;

// `typeof` guard: esbuild replaces the identifier with a literal when bundling;
// under tsx during development it is undeclared, and `typeof` on an undeclared
// identifier is safe rather than a ReferenceError.
declare const __MCP_VERSION__: string;
const VERSION = typeof __MCP_VERSION__ === "string" ? __MCP_VERSION__ : "dev";

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(HELP);
  process.exit(0);
}
if (argv.includes("--version") || argv.includes("-v")) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

/**
 * The default comes from the schema rather than being restated here.
 *
 * It previously appeared in both files, which is how a "fix the default" change
 * lands in one place and not the other. There is now one constant.
 */
const config = agentConfigSchema.parse({
  apiBaseUrl: process.env.LAUNCHENGINE_DEV_API_URL ?? DEFAULT_API_BASE_URL,
  apiKey: process.env.LAUNCHENGINE_DEV_API_KEY,
});

// stderr, never stdout: stdout carries the JSON-RPC stream, and a stray line
// there would corrupt the protocol and break the client.
process.stderr.write(
  `[launchengine-dev-mcp] v${VERSION} ready on stdio (API: ${config.apiBaseUrl}). ` +
    `${config.apiKey ? "Key loaded." : "No LAUNCHENGINE_DEV_API_KEY set — calls will fail with UNAUTHORIZED_KEY."}\n`,
);

start(config).catch((err) => {
  console.error("[launchengine-dev-mcp] fatal:", err);
  process.exit(1);
});
