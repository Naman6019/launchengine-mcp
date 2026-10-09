# LaunchEngine.dev MCP server

Find public posts where someone is asking for a product like yours, while they
are still choosing.

[LaunchEngine.dev](https://launchengine.dev) scans Reddit, Hacker News and the
open web for posts that match your product, scores each one 1–100 for buying
intent, and drafts a reply for you to edit and post. This server gives any MCP
client (Claude, Cursor, VS Code, Cline, Windsurf) the same data as six tools.

Nothing is ever posted for you.

## Quick start

1. Sign up at [launchengine.dev](https://launchengine.dev). A new workspace
   starts with **100 credits, no card required**.
2. Create a project for your product, then an API key under
   **Dashboard → Agents**. Keys look like `le_live_...`.
3. Add the server to your client (below), then ask it something.

## Install

Every client runs the same command, `npx -y @launchengine-dev/mcp`, with your
key in `LAUNCHENGINE_DEV_API_KEY`. Node 20 or newer is required.

### Claude Desktop

Download the `.mcpb` bundle from the
[latest release](https://github.com/Naman6019/launchengine-mcp/releases/latest)
and open it: Claude Desktop installs it and asks for the key.

Or add it by hand, in `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "launchengine": {
      "command": "npx",
      "args": ["-y", "@launchengine-dev/mcp"],
      "env": { "LAUNCHENGINE_DEV_API_KEY": "le_live_..." }
    }
  }
}
```

### Claude Code

```bash
claude mcp add launchengine \
  --env LAUNCHENGINE_DEV_API_KEY=le_live_... \
  -- npx -y @launchengine-dev/mcp
```

### Cursor, Cline and Windsurf

The same `mcpServers` block as Claude Desktop, in:

| Client | File |
| :--- | :--- |
| Cursor | `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project) |
| Cline | Cline → MCP Servers → Configure → `cline_mcp_settings.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |

### VS Code

`.vscode/mcp.json` uses `servers` rather than `mcpServers`, and can prompt for
the key once and keep it out of the file:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "launchengine-key",
      "description": "LaunchEngine.dev API key (le_live_...)",
      "password": true
    }
  ],
  "servers": {
    "launchengine": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@launchengine-dev/mcp"],
      "env": { "LAUNCHENGINE_DEV_API_KEY": "${input:launchengine-key}" }
    }
  }
}
```

## What to ask

- "List my LaunchEngine projects."
- "Find posts from the last 7 days scoring 80 or more for my project."
- "Scan live sources now, then show me the top five." *(uses a daily scan)*
- "Show me the full post for the top signal, then draft a technical reply."
- "Start monitoring the keyword 'alternative to Mixpanel' for this project."
- "How many credits do I have left?"

## Tools

| Tool | Cost | Changes data | What it does |
| :--- | :--- | :--- | :--- |
| `list_projects` | free | no | Your projects: name, URL, description, target ICP, competitors. Start here |
| `get_credit_balance` | free | no | Credit balance and plan |
| `find_intent_signals` | 1 credit | no | Scored posts for a project, highest intent first. `scan: true` searches live sources first |
| `get_intent_details` | free | no | One signal in full: post, author, score, reasons, saved draft |
| `draft_reply` | 1 credit | saves the draft | A reply for you to review and post, in a `consultative`, `direct` or `technical` tone |
| `subscribe_to_keyword` | free | yes | Add a keyword for a project's scans to search |

Every parameter is described in the tool schema your client receives. The full
reference, generated from the same schemas, is at
<https://launchengine.dev/docs/agents>.

The tools carry MCP annotations, so a client can ask before the two that spend
credits: neither is marked read-only, even though they only read posts.

## Costs and limits

- `find_intent_signals` and `draft_reply` cost 1 credit per call. A failed call
  is refunded. Everything else is free.
- `scan: true` also uses one of the workspace's daily scans (one a day on the
  free plan, shared across projects). Without it, the tool reads signals that
  earlier scans already found, which is fast and the usual choice.
- Requests are rate limited per key (60 a minute by default).

## Two things to know before you automate

**Drafts are assistive.** `draft_reply` returns text for a person to review and
post, and it never posts. Drafts help with the poster's problem and name no
product. Reddit and Hacker News both treat automated self-promotion as spam,
and your account is the one that would be actioned.

**Scanning is metered twice.** The call costs a credit, and `scan: true`
additionally spends the daily scan allowance.

## Environment

| Variable | Required | Default | Purpose |
| :--- | :--- | :--- | :--- |
| `LAUNCHENGINE_DEV_API_KEY` | yes | — | Workspace key, `le_live_...`. Every call fails with `UNAUTHORIZED_KEY` without it |
| `LAUNCHENGINE_DEV_API_URL` | no | `https://launchengine.dev/api` | API base URL. Only set this when running the API yourself |

The server starts and lists its tools without a key, so a client or registry
can inspect it before you have one.

## Troubleshooting

**It runs but nothing happens.** That is expected. This is a stdio server: it
prints one line to stderr, then waits for an MCP client to send JSON-RPC on
stdin.

```
$ npx -y @launchengine-dev/mcp
[launchengine-dev-mcp] v0.0.3 ready on stdio (API: https://launchengine.dev/api). Key loaded.
```

If you do not see that line, the install failed. `--help` prints usage and
config snippets, and `--version` prints the version; both exit immediately.

**`UNAUTHORIZED_KEY`.** The key is missing, mistyped or revoked. Check its
status on the Agents page, and create a new key if it was revoked.

**`INSUFFICIENT_CREDITS`.** The call costs more credits than the workspace
has. `get_credit_balance` shows the balance; the Billing page shows plans.

**`RATE_LIMITED` from a scan.** The day's scans are used up. Read stored
signals instead (`scan: false`), or wait for the allowance to reset.

**`'launchengine-dev-mcp' is not recognized`.** You ran `npx` from inside this
package's own directory, where npm treats it as the package you asked for and
never links its `bin`. Run it from anywhere else.

## Links

- Reference: <https://launchengine.dev/docs/agents>
- Issues: <https://github.com/Naman6019/launchengine-mcp/issues>
- npm: [`@launchengine-dev/mcp`](https://www.npmjs.com/package/@launchengine-dev/mcp)

## License

MIT
