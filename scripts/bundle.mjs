#!/usr/bin/env node
/**
 * Bundle the MCP server for publication.
 *
 * ## Why a bundle rather than plain `tsc`
 *
 * The server imports `@launchengine-dev/contracts`, which is a `workspace:*`
 * dependency and `private: true`. Both are correct inside the monorepo and both
 * are fatal on publish:
 *
 *   - npm does not understand the `workspace:` protocol, so the dependency would
 *     be published literally and `npm install` would fail to resolve it;
 *   - and Contracts is not published, so even a rewritten version range would
 *     point at a package that does not exist.
 *
 * Bundling resolves it by inlining those sources into one file, so the published
 * artefact has no dependency on any private package. Runtime dependencies that
 * are genuinely public (`@modelcontextprotocol/sdk`) are left external and
 * declared normally — bundling those too would vendor a third party's code into
 * our package, which is worse for security updates and licensing.
 *
 * ## The shebang
 *
 * `tsc` does not emit one, so the built file is not executable and the `bin`
 * entry fails with a permissions or interpreter error on install. It has to be
 * present in the *published* file, so it is prepended here rather than added to
 * `src/main.ts` — a shebang in a `.ts` file is a syntax error for the compiler.
 */

import { build } from "esbuild";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outFile = join(root, "dist", "cli.js");

// Read the version from the manifest rather than restating it, so the version a
// client sees in the handshake is the version npm published. Two sources would
// eventually disagree, and a silently stale version is hard to spot.
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const result = await build({
  entryPoints: [join(root, "src", "main.ts")],
  outfile: outFile,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  // Fail the build rather than silently shipping something that cannot run.
  logLevel: "warning",
  // Public runtime dependencies stay external and declared in package.json.
  // Everything else — including the private workspace packages — is inlined.
  external: ["@modelcontextprotocol/sdk", "@modelcontextprotocol/sdk/*"],
  // Replace the version placeholder with the manifest value. esbuild does this
  // as a compile-time constant, so the string ends up literally in the bundle.
  define: { __MCP_VERSION__: JSON.stringify(pkg.version) },
  metafile: true,
});

// esbuild preserves the source's leading comments but not a shebang, because
// there is none in the TypeScript. Prepend one so the file is directly
// executable, then mark it executable for good measure.
const body = readFileSync(outFile, "utf8");
if (!body.startsWith("#!")) {
  writeFileSync(outFile, `#!/usr/bin/env node\n${body}`);
}
try {
  chmodSync(outFile, 0o755);
} catch {
  // Windows has no meaningful exec bit; npm sets it on install from the bin
  // entry. Not worth failing a build over.
}

const bytes = readFileSync(outFile, "utf8").length;
console.log(`bundled -> dist/cli.js (${(bytes / 1024).toFixed(1)} kB)`);

// Report what stayed external, so an undeclared dependency cannot slip through:
// anything external that is not a real dependency would crash on first run.
const externals = new Set();
for (const output of Object.values(result.metafile.outputs)) {
  for (const imp of output.imports) {
    if (imp.external) externals.add(imp.path);
  }
}
console.log(`external: ${[...externals].sort().join(", ") || "(none)"}`);
