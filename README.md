# cmpose

Generate Compose Multiplatform projects on your own machine — from any AI agent, through MCP.

Ask your agent for an app ("a blank Compose Multiplatform app called Habits with Room and
theming") and get a buildable Android + iOS project from a tested template: Koin, Navigation,
Ktor, Room, DataStore, theming, multi-language, RevenueCat purchases, AdMob ads, detekt and CI
as options. What each option adds: [packages/mcp/README.md](packages/mcp/README.md).

It also generates Unity mobile games ("a 2D Unity game called SkyHopper with ads and
leaderboards"): a Unity 6 (URP) Android + iOS project from the pinned game template
(`Keremturker/cmpose-game-template`), as a `showcase` sample game (2D runner or 3D track) or a
`blank` game with flags for saving, theming, multi-language, networking, RevenueCat purchases,
AdMob ads and Play Games / Game Center leaderboards, up to 3 feature modules, your real IDs and
an optional GameCI workflow.

- `@cmpose/core` — the generator library (the same code [cmpose.dev](https://cmpose.dev) runs).
- `@cmpose/mcp` — a local stdio MCP server with four tools: `cmp_describe`, `cmp_generate`,
  `game_describe` and `game_generate`.

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
and rules. `game_generate` takes the same required fields plus optional `companyName`,
`templateType`, `render` (`2d` | `3d`), `flags` and `features` (blank only), `minSdk`,
`iosVersion`, `ci`, `ids` and `templateRef`; `game_describe` lists the flags, ID groups and limits.

## Develop

    npm install
    npm test
    npm run scan    # public hygiene scan: private paths, names, addresses, secrets

The 5 real-template tests in `packages/core/test/fileService.importSort.test.js` run only
when `CMP_REAL_TEMPLATE_DIR` points to a checkout of the template, e.g.
`CMP_REAL_TEMPLATE_DIR=/path/to/template-checkout npm test`; otherwise they are skipped.
