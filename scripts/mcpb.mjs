#!/usr/bin/env node
/**
 * Build the MCPB bundle: `dist/launchengine-dev-<version>.mcpb`.
 *
 * An MCPB (MCP Bundle) is a zip with a `manifest.json` and the server's code.
 * It is how a local stdio server is distributed outside npm: Claude Desktop
 * installs one with a double click and prompts for the API key itself, and
 * Smithery publishes local servers only in this form
 * (`smithery mcp publish ./dist/launchengine-dev-<version>.mcpb`).
 *
 * ## One file, everything inlined
 *
 * The npm build leaves `@modelcontextprotocol/sdk` external and declared as a
 * dependency, because npm installs it. An MCPB has no install step - the client
 * runs `server/index.js` straight out of the unpacked bundle - so here every
 * dependency is inlined and the bundle needs nothing but Node.
 *
 * ## The manifest is generated, not written
 *
 * Name, version, description and links come from package.json, and the tool
 * list comes from the built server's own `tools/list` answer. A hand-written
 * manifest would be one more copy of the tool list to forget when a tool
 * changes; asking the artifact what it serves cannot be wrong about it.
 */

import { build } from "esbuild";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const stage = join(root, "dist", "mcpb");
const out = join(root, "dist", `launchengine-dev-${pkg.version}.mcpb`);

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "server"), { recursive: true });

const entry = join(stage, "server", "index.js");
await build({
  entryPoints: [join(root, "src", "main.ts")],
  outfile: entry,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  logLevel: "warning",
  define: { __MCP_VERSION__: JSON.stringify(pkg.version) },
  // Inlined CommonJS dependencies may still call require(); give the ESM output one.
  banner: {
    js: "import { createRequire as __mcpbCreateRequire } from 'node:module'; const require = __mcpbCreateRequire(import.meta.url);",
  },
});

/** Ask the bundled server for its tools over stdio, the way a client would. */
function listTools(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("the bundled server did not answer tools/list within 20s"));
    }, 20_000);
    child.stdout.on("data", (d) => {
      buf += d.toString();
      for (const line of buf.split("\n")) {
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 2) {
          clearTimeout(timer);
          child.kill();
          resolve(msg.result.tools);
        }
      }
    });
    child.stdin.write(
      [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mcpb-build", version: "1" } },
        },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ]
        .map((m) => `${JSON.stringify(m)}\n`)
        .join(""),
    );
  });
}

const tools = await listTools(entry);
const repoUrl = String(pkg.repository?.url ?? "").replace(/^git\+/, "");

const manifest = {
  manifest_version: "0.3",
  name: "launchengine-dev",
  display_name: "LaunchEngine.dev",
  version: pkg.version,
  description:
    "Find public posts where someone is asking for a product like yours, scored 1-100 for buying intent, with reply drafts you review and post.",
  long_description:
    "LaunchEngine.dev scans Reddit, Hacker News and the open web for posts where someone is asking for a tool like yours, scores each one 1-100 for buying intent, and drafts a reply for you to edit and post yourself. Nothing is ever posted for you. Two tools cost a credit (find_intent_signals, draft_reply); the rest are free, and a new workspace starts with 100 credits.",
  author: { name: "LaunchEngine.dev", url: "https://launchengine.dev" },
  repository: { type: "git", url: repoUrl },
  homepage: "https://launchengine.dev",
  documentation: "https://launchengine.dev/docs/agents",
  support: pkg.bugs?.url,
  icon: "icon.png",
  license: pkg.license,
  keywords: pkg.keywords,
  privacy_policies: ["https://launchengine.dev/privacy"],
  compatibility: {
    platforms: ["darwin", "win32", "linux"],
    runtimes: { node: pkg.engines?.node ?? ">=20" },
  },
  user_config: {
    api_key: {
      type: "string",
      title: "API key",
      description: "Your workspace key (le_live_...). Create one at launchengine.dev under Dashboard > Agents.",
      sensitive: true,
      required: true,
    },
  },
  server: {
    type: "node",
    entry_point: "server/index.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/index.js"],
      env: { LAUNCHENGINE_DEV_API_KEY: "${user_config.api_key}" },
    },
  },
  tools: tools.map((t) => ({ name: t.name, description: t.description })),
  tools_generated: false,
};

writeFileSync(join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
copyFileSync(join(root, "icon.png"), join(stage, "icon.png"));
for (const file of ["README.md", "LICENSE"]) {
  if (existsSync(join(root, file))) copyFileSync(join(root, file), join(stage, file));
}

// The official packer validates the manifest against the spec before zipping.
const mcpb = (args) =>
  spawnSync("npx", ["-y", "@anthropic-ai/mcpb@2", ...args], { stdio: "inherit", shell: process.platform === "win32" });
if (mcpb(["validate", join(stage, "manifest.json")]).status !== 0) process.exit(1);
rmSync(out, { force: true });
if (mcpb(["pack", stage, out]).status !== 0) process.exit(1);

console.log(`\nmcpb -> ${out.slice(root.length + 1)} (${tools.length} tools)`);
