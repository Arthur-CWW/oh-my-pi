# AGENTS.md

## What this is

`browser-extensions` is a pnpm monorepo for agent-facing Chrome/Firefox/Helium extensions, replay tools, and browser API reverse-engineering helpers.

Keep extension packages under `extensions/`, shared code under `packages/`, local daemons/CLIs under `tools/`, workflow skills under `skills/`, and copied target-extension source under `reveng/`.

## Build and verify

```bash
pnpm build                         # recursive package builds
pnpm typecheck                     # recursive typechecks
pnpm check                         # recursive package checks
pnpm test                          # recursive package tests
pnpm zip:x-bookmark-sync-devtools  # build + zip X bookmark DevTools extension
pnpm smoke:illiterati-tts          # build + smoke illiterati TTS
pnpm skill:reverse-engineer        # analyze reveng/vidiq-vision
```

Use `pnpm --filter <package> <script>` for one extension/tool; verify the script exists in that package first.

## Invariants

- Browser automation stays background-safe. Do not steal user focus unless explicitly asked.
- Do not use `page.bringToFront()`, `Target.activateTarget`, AppleScript `activate`, macOS Accessibility click/type automation, or foreground `open` without `-g`.
- Prefer a dedicated automation browser/profile, CDP/BiDi, DOM evaluation, CDP input events, `Target.createTarget({ background: true })`, `open -g -na "Helium" --args ...`, or an AeroSpace quarantine workspace when a window is unavoidable.
- Keep copied third-party extension source in `reveng/`; promote reusable code to `packages/` and agent workflow instructions to `skills/`.
- Dependencies are personal-tooling pragmatic but intentional. Share a package when more than one extension needs the same code.

## Orientation

| What | Where |
|---|---|
| Extension packages | `extensions/` |
| Shared libraries | `packages/` |
| Agent skills | `skills/` |
| Local tools and bridges | `tools/` |
| Reverse-engineering snapshots | `reveng/` |
| Architecture/testing/background automation notes | `docs/` |
