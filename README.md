# cmpose

Generate Compose Multiplatform projects on your own machine — from any AI agent, through MCP.

- `@cmpose/core` — the generator library (the same code cmpose.dev runs).
- `@cmpose/mcp` — a local stdio MCP server with two tools: `cmp_describe` and `cmp_generate`.

Requires Node.js 20+ and git. The first generation downloads the pinned template
(`Keremturker/cmpose-template`) into `~/.cache/cmpose` (override: `CMPOSE_CACHE_DIR`).

## Use with Claude Code

    claude mcp add cmpose -- npx -y @cmpose/mcp

## Use with other MCP clients

Add the server to the client's `mcpServers` configuration:

```json
{
  "mcpServers": {
    "cmpose": {
      "command": "npx",
      "args": ["-y", "@cmpose/mcp"]
    }
  }
}
```

`cmp_generate` takes `projectName`, `appName`, `packageName` and an absolute `outputDir`
(required), plus optional `templateType` (`showcase` | `blank`), `features`, `featuresConfig`
(blank only), `minSdk`, `iosVersion`, `ci` and `templateRef`; `cmp_describe` lists the defaults
and rules.

## Develop

    npm install
    npm test
    npm run scan    # public hygiene scan: private paths, names, addresses, secrets

The 5 real-template tests in `packages/core/test/fileService.importSort.test.js` run only
when `CMP_REAL_TEMPLATE_DIR` points to a checkout of the template, e.g.
`CMP_REAL_TEMPLATE_DIR=/path/to/template-checkout npm test`; otherwise they are skipped.
