# Tech Debt

Last updated: 2026-06-24

This is the short, top-level scratchpad for repo/workflow cleanup. Keep details in `docs/plans/*` when they need more analysis.

## Task tracker sync

- ASMR companion / SynthID-conditioned Seedance is done after review-fix commit `cacf7653`; reviewer proof starts at `docs/qa/asmr-companion-goal6-final-handoff-20260624.md` and `docs/qa/asmr-companion-goal6-artifact-inventory-20260624.json`, with regenerable proof roots under `data/asmr-companion/goal2/seedance-parent-proof/`, `data/asmr-companion/goal3-spatial-proof/`, `data/asmr-companion/goal4-planning/`, and `data/asmr-companion/goal5-pipeline-proof/`.

## Skills / Pi resource loading

Resolved 2026-06-22, 2026-06-23, and 2026-06-24:

- pi-skills moved to `vendor/badlogic/pi-skills/`.
- first-party skills regrouped into domain discovery parents under `skills/{core,browser,provider,research,design,media}/`.
- `packages/web-access/skills` removed; `packages/web-access` now exposes only its extension entrypoint.
- `agent-communication` was removed from the root Pi skill manifest and repo skill directory on 2026-06-23.
- T-2026-06-09-007 repo-local stale checkout state is closed: `packages/web-access/skills/`, root `chrome-devtools-mcp/`, `deterministic-simulation-testing/`, and `packages/personal-core-skills/` are absent; `package.json` points at vendored skill paths instead of stale local checkouts.

- The project skill list is now curated in root `package.json` with explicit repo and vendored skill directories.
  - Vendored badlogic Pi skills now live under `vendor/badlogic/pi-skills/` and are loaded explicitly.
  - Former `packages/web-access/skills/*` entries were moved out of `web-access`; the package now exposes only its extension entrypoint.
  - `chrome-devtools-mcp` was moved to `vendor/chrome-devtools-mcp/` and is intentionally not globally loaded.
  - Full `agent-stuff` source is vendored for reference at `vendor/mitsuhiko/agent-stuff`; keep it reference-only unless a specific skill is promoted.
- Remaining concrete skill cleanup:
  - archive or remove `/Users/arthur/.pi/skills/pi-skills/` after preserving any needed `browser-tools/output/jimeng-lab/raw/` captures; do not recreate repo-local symlinks
  - reconcile overlapping browser/research skills only when a concrete workflow needs it
  - keep Codex/OpenAI router skills opt-in, not globally loaded by default
  - see `docs/plans/skill-inventory-and-rationalization.md` and `docs/reference/pi-resources-inventory.md` for the full inventory and usage scan

## Package / folder organization

- `packages/web-access` still does too much: web search, fetch, cookies, YouTube, Codex session import, frontend LLM browser, vim-lite, cockpit, and chat/agent-server bridges.
- Skills are now out of `web-access`; the package split is deferred because `@wirebabel/pi-web-access` is already published and needs a compatibility/deprecation plan.
- Consider splitting when stable:
  - `packages/web-access` — web search/fetch/cookies/transcripts only
  - `packages/frontend-llm-browser` — ChatGPT/AI Studio/Grok browser automation
  - `packages/pi-editor-tools` — `vim-lite`
  - `packages/pi-cockpit` — agent cockpit/session registry
  - `packages/computer-use` — CuaDriver wrapper + macOS UI skills
  - private `pi-personal-core-skills` repo — commit/uv/tmux/github/etc.

## Workspace / context ontology

- `catalog/workspaces.yml` is the YAML registry for ownership roots, ad hoc context roots, capability discovery parents, packet policy, and session path-alias conventions.
- Do not move sibling folders into `~/agents` just to make them visible to agents. Add absolute context roots or packet links to the catalog.
- Keep `oh-my-pi/` at repo root while it is an active first-class OMP fork; do not bury it under `vendor/`.
- Hybrid boundary for now: keep active co-evolving prototypes in this repo, but use the catalog to mark what should later promote to `~/products`, `~/apps`, or `~/exploratory`.

## Codex plugin import

- `.pi/extensions/codex-plugin-manager/` is tracked as the official opt-in UI for vendored Codex plugin skills.
- Keep Codex plugin skills opt-in; do not make all router skills global. macOS/iOS app skills are useful, finance/sales/etc. should be enabled only per project.

## AltTab quality-of-life

- AltTab preferences are stored in macOS defaults, not a plain repo JSON file:
  - domain: `com.lwouis.alt-tab-macos`
  - plist: `~/Library/Preferences/com.lwouis.alt-tab-macos.plist`
  - key: `exceptions` is a JSON string.
- CuaDriver is hidden from AltTab via:

```json
{"bundleIdentifier":"com.trycua.driver","hide":"1","ignore":"0"}
```

- To hide another app from AltTab, add the same shape with that app's bundle id. Use `defaults read com.lwouis.alt-tab-macos exceptions | python3 -m json.tool` to inspect the current list.
