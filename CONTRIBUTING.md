# Contributing

This repository is generated from the LaunchEngine.dev monorepo, where the MCP
server is `apps/mcp` and the tool definitions are `packages/contracts`
(vendored here as `src/contracts/`). It is regenerated on every release, so a
change made only here is overwritten by the next export.

Issues and pull requests are welcome here. An accepted pull request is ported
upstream and arrives back in the next export.

## Develop

```bash
npm install
npm test        # builds, bundles, then drives dist/cli.js over stdio
```

`npm run mcpb` builds the one-file MCPB bundle (`dist/*.mcpb`) used for
Claude Desktop and Smithery.

## Publish (maintainers)

```bash
npm publish                      # npm: @launchengine-dev/mcp
mcp-publisher publish            # official MCP Registry, reads server.json
npm run mcpb && smithery mcp publish ./dist/launchengine-dev-<version>.mcpb -n <namespace>/launchengine-dev
```

Bump `version` in package.json and both versions in server.json together;
`npm test` fails if they disagree.
