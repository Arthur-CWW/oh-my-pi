# AGENTS.md

## Project

Personal browser-extension monorepo for agent-facing browser tooling.

Primary goals:

- Build many small Chrome/Firefox/Helium extensions under `extensions/`.
- Share protocol/storage/replay code under `packages/`.
- Put local CLIs, agent bridges, and smoke tools under `tools/` or `scripts/`.
- Prefer background-safe browser automation: do not steal user focus unless asked.

## Layout

```text
extensions/            Browser extensions, one package per extension
packages/              Shared TypeScript libraries used by extensions/tools
skills/                Agent skills and skill-specific TypeScript helpers
tools/                 Local daemons/CLIs for agents and native bridges
reveng/   Unpacked extension case studies and source snapshots
scripts/               Repo-level build/check/smoke scripts
docs/                  Architecture notes and operational how-tos
```

## Commands

```bash
pnpm build       # build all packages/extensions with a build script
pnpm typecheck   # typecheck all packages/extensions with a typecheck script
pnpm check       # run all package checks
pnpm test        # run package tests when present
```

Extension-specific:

```bash
pnpm --filter x-bookmark-sync-devtools build
pnpm --filter x-bookmark-sync-devtools check
pnpm --filter x-bookmark-sync-devtools zip
pnpm --filter dev-browser-extension build
pnpm --filter illiterati-tts build
pnpm --filter illiterati-tts smoke
pnpm skill:reverse-engineer
```

## Reverse engineering rule

Keep copied third-party or target extension source under `reveng/`. Move reusable code into `packages/`, and keep agent workflow instructions under `skills/`.

## Browser automation rule

Use a dedicated automation browser/profile and CDP/BiDi. Avoid foreground UI automation.

Do not use:

- `page.bringToFront()`
- `Target.activateTarget`
- AppleScript `activate`
- macOS Accessibility click/type automation
- launching URLs with `open` unless using `-g`

Prefer:

- `open -g -na "Helium" --args ...`
- `Target.createTarget({ background: true })`
- DOM evaluation and CDP input events
- an AeroSpace quarantine workspace for unavoidable browser windows

## Dependency policy

This is personal tooling, but keep direct dependencies intentional. Prefer shared libraries in `packages/` when more than one extension needs the same code.
