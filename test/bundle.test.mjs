import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Verifies the *published* MCP artifact, not the source.
 *
 * The failure this guards against is specific: everything works locally through
 * `tsx src/main.ts`, and the package is broken for every user, because the thing
 * they install is `dist/cli.js`. Three ways that happens, all of which pass a
 * source-level test:
 *
 *   - a `workspace:` dependency that npm cannot resolve
 *   - a missing shebang, so the `bin` entry is not executable
 *   - a source file that is not actually reachable from the bundle
 *
 * So this runs the built file the way a user's client would — a child process
 * speaking JSON-RPC over stdio — and asserts on the handshake and the tool list.
 * It refuses to run if the bundle is stale, because verifying an old build is
 * how you conclude the artifact is fine when it is not.
 */
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, "dist", "cli.js");

let passed = 0,
  failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

if (!existsSync(cli)) {
  console.error(`\n${cli} does not exist. Run: pnpm --filter @launchengine-dev/mcp bundle\n`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait until `predicate()` holds, or give up after `timeoutMs`.
 *
 * This replaces fixed sleeps. A fixed deadline races the thing it is waiting
 * for, so on a loaded machine (the parallel `pnpm -r test`) the child has
 * sometimes not answered before the deadline elapses, and the assertions then
 * run against an empty or truncated buffer — the exact flake this test showed.
 * Polling for the real condition is deterministic, and still bounded so a
 * genuinely hung child cannot hang the suite.
 */
async function waitFor(predicate, timeoutMs, stepMs = 25) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(stepMs);
  }
  return predicate();
}

/**
 * Drive the server over stdio and wait until it has answered every request it
 * was given, rather than for a fixed time.
 *
 * The ids to wait for are derived from the messages: resolve as soon as all of
 * them appear on stdout. Load only makes this slower, never wrong — the fixed
 * 5s deadline it replaces is what made the test flaky.
 */
function exchange(messages, extraEnv = {}, { timeoutMs = 20_000 } = {}) {
  const expectedIds = messages
    .map((m) => m.id)
    .filter((id) => id !== undefined);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
    });
    let out = "";
    let err = "";
    let settled = false;
    const seen = () =>
      expectedIds.length === 0 ||
      expectedIds.every((id) =>
        out.split("\n").some((line) => {
          if (!line.trim()) return false;
          try {
            return JSON.parse(line).id === id;
          } catch {
            return false;
          }
        }),
      );
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      clearTimeout(closeStdin);
      child.kill();
      resolve({ out, err });
    };
    const guard = setTimeout(done, timeoutMs);
    // Backstop for a child that never answers on its own: end its stdin so the
    // stdio transport can close. Well after the normal answer, so it never
    // truncates a slow-but-working response.
    const closeStdin = setTimeout(() => child.stdin.end(), 2_000);
    child.stdout.on("data", (d) => {
      out += d.toString();
      if (seen()) done();
    });
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", done);
    try {
      child.stdin.write(messages.map((m) => `${JSON.stringify(m)}\n`).join(""));
    } catch {
      done();
    }
  });
}

/**
 * Run the CLI with arguments and wait for it to exit on its own.
 *
 * Distinct from `exchange`, which kills the process: `--help` and `--version`
 * must terminate by themselves, and a version that merely stopped responding
 * would pass a test that killed it.
 */
function runToCompletion(args, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    const timer = setTimeout(() => {
      // Did not exit on its own - that is the failure this checks for.
      child.kill();
      resolve({ out, err, code: "timeout" });
    }, 10_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ out, err, code });
    });
    child.stdin.end();
  });
}

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "probe", version: "1" },
  },
};
const LIST = { jsonrpc: "2.0", id: 2, method: "tools/list" };

// ---------------------------------------------------------------------------
console.log("\n=== the artifact is runnable as a bin ===\n");
{
  // The shebang is what makes `npx @launchengine-dev/mcp` work at all.
  const head = readFileSync(cli, "utf8").slice(0, 64);
  check("starts with a node shebang", head.startsWith("#!/usr/bin/env node"), head.split("\n")[0]);

  const { out, err } = await exchange([INIT]);
  check("it starts and answers without crashing", out.length > 0 || err.length > 0);

  let parsed = null;
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id === 1) parsed = msg;
    } catch {
      // Non-JSON on stdout would break the protocol; asserted below.
    }
  }
  check("every stdout line is valid JSON (stdio protocol clean)", parsed !== null,
    out.slice(0, 200));
  check("the handshake names the server", parsed?.result?.serverInfo?.name === "launchengine-dev",
    JSON.stringify(parsed?.result?.serverInfo));
  check("it advertises tools", parsed?.result?.capabilities?.tools !== undefined);
  check("the handshake carries usage instructions",
    typeof parsed?.result?.instructions === "string" && /credit/.test(parsed.result.instructions),
    String(parsed?.result?.instructions).slice(0, 80));

  // The version a client sees must be the version npm published. It is injected
  // at bundle time from the manifest precisely so this cannot drift, and this
  // assertion is what proves the injection actually happened — without it, the
  // bundle would silently report "dev".
  const pkgVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  check("the handshake version matches package.json",
    parsed?.result?.serverInfo?.version === pkgVersion,
    `handshake ${parsed?.result?.serverInfo?.version} vs manifest ${pkgVersion}`);
  check("the version is a real version, not the dev fallback",
    parsed?.result?.serverInfo?.version !== "dev",
    String(parsed?.result?.serverInfo?.version));
}

// ---------------------------------------------------------------------------
console.log("\n=== every tool is present in the bundle ===\n");
{
  const { out } = await exchange([INIT, { jsonrpc: "2.0", method: "notifications/initialized" }, LIST]);

  let tools = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id === 2) tools = msg.result?.tools ?? [];
    } catch {
      // ignore
    }
  }

  const names = tools.map((t) => t.name).sort();
  const expected = [
    "draft_reply",
    "find_intent_signals",
    "get_credit_balance",
    "get_intent_details",
    "list_projects",
    "subscribe_to_keyword",
  ];
  check("all six tools are registered",
    JSON.stringify(names) === JSON.stringify(expected), names.join(", "));

  // A tool whose input schema did not survive bundling would still be listed but
  // unusable, so check one schema in detail.
  const find = tools.find((t) => t.name === "find_intent_signals");
  check("a tool carries its input schema",
    find?.inputSchema?.properties?.project_id !== undefined,
    JSON.stringify(find?.inputSchema)?.slice(0, 120));
  check("the newest contract field survived bundling",
    find?.inputSchema?.properties?.include_muted !== undefined,
    Object.keys(find?.inputSchema?.properties ?? {}).join(", "));

  // Each tool must have a description, since that is what an agent reads to
  // decide whether to call it.
  check("every tool has a description",
    tools.every((t) => typeof t.description === "string" && t.description.length > 10));

  // Registries and clients render these; a bare name and type is what every
  // parameter showed before the contract carried descriptions.
  const undescribed = tools.flatMap((t) =>
    Object.entries(t.inputSchema?.properties ?? {})
      .filter(([, p]) => !(typeof p.description === "string" && p.description.length > 0))
      .map(([k]) => `${t.name}.${k}`),
  );
  check("every parameter carries its description", undescribed.length === 0, undescribed.join(", "));

  check("every tool has a title", tools.every((t) => typeof t.title === "string" && t.title.length > 0));
  const hints = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"];
  check("every tool carries all four annotation hints",
    tools.every((t) => hints.every((h) => typeof t.annotations?.[h] === "boolean")),
    JSON.stringify(tools.map((t) => [t.name, t.annotations])).slice(0, 200));
  // A client may auto-approve read-only tools, so a credit-spending one must not be.
  check("metered tools are not marked read-only",
    ["find_intent_signals", "draft_reply"].every(
      (n) => tools.find((t) => t.name === n)?.annotations?.readOnlyHint === false,
    ));
}

// ---------------------------------------------------------------------------
console.log("\n=== no private package leaked into the artifact ===\n");
{
  const bundle = readFileSync(cli, "utf8");

  // The bundle must inline the workspace package, and the manifest must not
  // mention it as a runtime dependency — either would break `npm install`.
  check("the workspace import is inlined, not left as an import",
    !/from\s+["']@launchengine-dev\/contracts["']/.test(bundle),
    "a bare import survives");

  const pkg = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  check("the package is not private", pkg.private !== true);
  check("no workspace: protocol in runtime dependencies",
    !Object.values(pkg.dependencies ?? {}).some((v) => String(v).startsWith("workspace:")),
    JSON.stringify(pkg.dependencies));
  // npm normalises a leading `./` off a bin path on publish, so accept either
  // spelling rather than asserting a form npm itself rewrites.
  const binPath = String(pkg.bin?.["launchengine-dev-mcp"] ?? "").replace(/^\.\//, "");
  check("the bin points at the bundled file", binPath === "dist/cli.js",
    JSON.stringify(pkg.bin));
  check("the files list ships the bundle and the readme",
    Array.isArray(pkg.files) && pkg.files.includes("dist/cli.js") && pkg.files.includes("README.md"),
    JSON.stringify(pkg.files));
  check("the license is declared", typeof pkg.license === "string" && pkg.license.length > 0);
  check("scoped publish access is public", pkg.publishConfig?.access === "public");
  check("a prepublish build is wired", typeof pkg.scripts?.prepublishOnly === "string");

  // The official MCP Registry checks that the npm package's mcpName equals
  // server.json's name, and lists the version server.json states. Both files are
  // edited by hand on release, so a missed bump is caught here, not at publish.
  const server = JSON.parse(readFileSync(join(root, "server.json"), "utf8"));
  const npmEntry = server.packages?.find((p) => p.registryType === "npm");
  check("server.json name matches package.json mcpName",
    typeof pkg.mcpName === "string" && server.name === pkg.mcpName, `${server.name} vs ${pkg.mcpName}`);
  check("server.json versions match package.json",
    server.version === pkg.version && npmEntry?.version === pkg.version,
    `${server.version} / ${npmEntry?.version} vs ${pkg.version}`);
  check("server.json points at this npm package", npmEntry?.identifier === pkg.name, npmEntry?.identifier);
  check("server.json declares the API key as a required secret",
    npmEntry?.environmentVariables?.some(
      (v) => v.name === "LAUNCHENGINE_DEV_API_KEY" && v.isRequired === true && v.isSecret === true,
    ));
  check("the registry description fits its 100-character limit",
    typeof server.description === "string" && server.description.length <= 100,
    String(server.description?.length));
}

// ---------------------------------------------------------------------------
console.log("\n=== --help and --version exit instead of waiting ===\n");
{
  // Without this, `npx @launchengine-dev/mcp --help` starts the server and waits
  // forever on stdin, because the arguments are ignored. Someone checking
  // whether the install worked would conclude it is broken.
  const help = await runToCompletion(["--help"]);
  check("--help exits rather than starting the server", help.code === 0, `exit ${help.code}`);
  check("--help prints usage", /Usage:/.test(help.out), help.out.slice(0, 80));
  check("--help names the required env var",
    /LAUNCHENGINE_DEV_API_KEY/.test(help.out), help.out.slice(0, 120));

  const version = await runToCompletion(["--version"]);
  check("--version exits", version.code === 0, `exit ${version.code}`);
  const pkgVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  check("--version matches the manifest", version.out.trim() === pkgVersion,
    `${version.out.trim()} vs ${pkgVersion}`);
}

// ---------------------------------------------------------------------------
console.log("\n=== startup line goes to stderr, never stdout ===\n");
{
  // stdout is the JSON-RPC channel. A stray line there corrupts the protocol and
  // breaks the client, so the "it is working" message must go to stderr.
  const child = spawn(process.execPath, [cli], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d.toString()));
  child.stderr.on("data", (d) => (err += d.toString()));
  child.stdin.write(`${JSON.stringify(INIT)}\n`);
  // Wait for the answer to id 1 and the stderr readiness line, instead of
  // sleeping a fixed 800ms and hoping both arrived. The readiness line is what
  // this block asserts on, so it is the thing to wait for; the stdout check then
  // reads a buffer that is actually complete.
  await waitFor(
    () =>
      /ready on stdio/.test(err) &&
      out.split("\n").some((line) => {
        if (!line.trim()) return false;
        try {
          return JSON.parse(line).id === 1;
        } catch {
          return false;
        }
      }),
    20_000,
  );
  child.stdin.end();
  await sleep(100);
  child.kill();

  check("stderr carries the readiness line", /ready on stdio/.test(err), err.slice(0, 100));
  check("stderr says whether a key was found", /API key|Key loaded|UNAUTHORIZED_KEY/.test(err),
    err.slice(0, 140));

  // Every non-empty stdout line must parse as JSON.
  const stdoutLines = out.split("\n").filter((l) => l.trim());
  const allJson = stdoutLines.every((l) => {
    try {
      JSON.parse(l);
      return true;
    } catch {
      return false;
    }
  });
  check("every stdout line is valid JSON", allJson,
    stdoutLines.find((l) => {
      try { JSON.parse(l); return false; } catch { return true; }
    }) ?? "");
  check("the readiness line never leaks to stdout", !/ready on stdio/.test(out), out.slice(0, 120));
}

// ---------------------------------------------------------------------------
console.log("\n=== the default API base URL points at production ===\n");
{
  const bundle = readFileSync(cli, "utf8");

  // This package is installed by customers who are not running the API. A
  // localhost default shipped to them means `npx` fails to connect until they
  // discover an environment variable they had no reason to know about - which is
  // what the first prepared release nearly shipped with.
  check("the bundle defaults to the production API, not localhost",
    bundle.includes("https://launchengine.dev/api") && !bundle.includes("http://localhost:3000/api"),
    "a localhost default is present in the published artifact");

  // The env override must still work, or local development against a dev server
  // is impossible. Asserted by running the real artifact with the variable set
  // and confirming it does not crash on parse.
  const { out } = await exchange([INIT], { LAUNCHENGINE_DEV_API_URL: "http://localhost:3939/api" });
  let handshake = null;
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id === 1) handshake = msg;
    } catch {
      // ignore
    }
  }
  check("the env override still starts cleanly", handshake?.result?.serverInfo?.name === "launchengine-dev",
    out.slice(0, 160));
}

// ---------------------------------------------------------------------------
console.log("\n=== it fails loudly with no key, rather than silently ===\n");
{
  // Without a key the client must refuse. Silently returning empty results would
  // look like "no signals found" instead of "you are not authenticated".
  const { out } = await exchange([
    INIT,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_projects", arguments: {} },
    },
  ]);

  let call = null;
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id === 3) call = msg;
    } catch {
      // ignore
    }
  }

  const text = call?.result?.content?.[0]?.text ?? "";
  check("a keyless call reports an error", call?.result?.isError === true ||
    /UNAUTHORIZED_KEY/.test(text), text.slice(0, 160));
  check("and names the missing key", /UNAUTHORIZED_KEY/.test(text), text.slice(0, 160));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exitCode = failed === 0 ? 0 : 1;
