# @cmpose/mcp

Ask your AI agent for a **Compose Multiplatform** app and get a real, buildable Android + iOS
project on disk, generated locally from a tested template. This is a local stdio MCP server
with two tools, `cmp_describe` and `cmp_generate`. It is the same generator that runs
[cmpose.dev](https://cmpose.dev), with no account, no API key and no upload.

> "Create a blank Compose Multiplatform app called Habits, package com.acme.habits, in
> ~/Projects, with Room, light/dark theming and AdMob ads."

## Install

Requires Node.js 20+ and git.

**Claude Code**

    claude mcp add cmpose -- npx -y @cmpose/mcp

**Claude Desktop, Cursor, Windsurf and other MCP clients** (`mcpServers` config):

```json
{
  "mcpServers": {
    "cmpose": { "command": "npx", "args": ["-y", "@cmpose/mcp"] }
  }
}
```

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "cmpose": { "type": "stdio", "command": "npx", "args": ["-y", "@cmpose/mcp"] }
  }
}
```

## What you get

Every project has `androidApp`, `iosApp` (Xcode project), a `shared` module with Koin and
Navigation, logging (Kermit), image loading (Coil), in-app review, update check, an About
screen, a `build-logic` with convention plugins, and a README with a release checklist.

- **Template:** `showcase` (home, onboarding and paywall demo screens) or `blank`
  (a clean shell with a sample feature).
- **Options for `blank`:** Ktor networking (with an optional in-app network inspector),
  theming (light/dark/system), multi-language strings, DataStore, Room (KMP, bundled SQLite),
  RevenueCat purchases with a custom Compose paywall, AdMob ads with UMP/ATT consent, detekt.
- **Your own feature modules:** up to 3, each with contract/data/domain/presentation layers.
- **CI:** an optional GitHub Actions workflow.
- **Your names everywhere:** package, bundle id, app name, min SDK and iOS deployment target.

## Tools

- `cmp_describe`: the defaults, the options and the rules (name formats, limits, which option
  needs which). Agents call it first.
- `cmp_generate`: creates the project. Required: `projectName` (letters only), `appName`,
  `packageName` (e.g. `com.acme.habits`) and an absolute `outputDir`. Optional:
  `templateType`, `features`, `featuresConfig`, `minSdk`, `iosVersion`, `ci`, `templateRef`.
  It returns the project path, the template version it used, warnings (e.g. test ad IDs to
  replace) and next steps.

## How it works

Generation runs entirely on your machine. The first call downloads the pinned template
([Keremturker/cmpose-template](https://github.com/Keremturker/cmpose-template)) into
`~/.cache/cmpose` (override with `CMPOSE_CACHE_DIR`), and later calls reuse it. Each release
pins one template tag, so `@cmpose/mcp@x.y.z` always generates the same project.

Source and issues: [github.com/Keremturker/cmpose](https://github.com/Keremturker/cmpose).
MIT licensed. The projects you generate are yours.
