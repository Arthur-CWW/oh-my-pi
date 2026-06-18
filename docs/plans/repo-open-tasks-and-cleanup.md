# Repo Open Tasks and Cleanup Plan

Date: 2026-06-09

## Current diagnosis

This repo has become a personal Pi platform monorepo, not just `pi-web-access`:

- web search/fetch/browser/LLM frontend tools
- local Pi skills and prompt templates
- Codex plugin experiments
- macOS computer-use/CuaDriver notes
- dynamic workflow/runtime experiments
- Slotok / AI UGC / Jimeng / Twitter archive apps and packages
- local orchestration/cockpit prototypes

That is fine for exploration, but it needs sharper package boundaries and fewer globally loaded resources.

## Immediate repo state

Clean committed baseline exists for:

- CuaDriver/macOS computer-use docs and skill.
- Project skill curation: `dreamina-cli` removed; root/web-access manifests no longer load every skill folder.
- Top-level `TECH_DEBT.md`.
- AltTab CuaDriver hide setting note.

Still dirty / pending at time of writing:

- `.pi/extensions/codex-plugin-manager/index.ts` — project-local Codex plugin manager; should be tracked if we keep using it.
- `vendor/openai/codex-plugin-*` router subset — small vendored plugin-skill material needed by the manager.
- `pi-personal-core-skills` — private repo with curated global/core skills copied from `agent-stuff`; now installed globally via `git:git@github.com:Arthur-CWW/pi-personal-core-skills@main`.
- `scripts/imagegen-observe.py` — standalone OpenAI Image API diagnostic wrapper; decide keep, move, or delete.

## What to do next

### 1. Finish resource hygiene first

Goal: Pi startup should only show skills that are intentionally global for Arthur or intentionally project-local.

Recommended sequence:

1. Track the Codex plugin manager and the small router-skill vendor subset. Done.
2. Create and install private `pi-personal-core-skills` repo as the replacement for noisy global `agent-stuff`. Done.
3. Vendor full `agent-stuff` source as reference under `vendor/mitsuhiko/agent-stuff`. Done.
4. Update `~/.pi/agent/settings.json` to remove broad `git:github.com/mitsuhiko/agent-stuff` and replace it with `git:git@github.com:Arthur-CWW/pi-personal-core-skills@main`. Done.
5. Remove the temporary in-monorepo `packages/personal-core-skills` copy. Done.
6. Decide whether `scripts/imagegen-observe.py` belongs in `packages/ugc-cli`, `scripts/diagnostics/`, or should be deleted.
7. Remove stale local skill checkouts from `packages/web-access/skills/`:
   - `pi-skills` symlink
   - ignored `chrome-devtools-mcp/` checkout
   - empty/unused scratch dirs such as `deterministic-simulation-testing/` if truly empty

### 2. Split `packages/web-access`

`packages/web-access` currently contains too many unrelated responsibilities.

Recommended package boundaries:

| Future package | Move from `web-access` | Why |
|---|---|---|
| `packages/web-access` | search/fetch/cookies/YouTube only | keep name honest |
| `packages/frontend-llm-browser` | ChatGPT/AI Studio/Grok frontend browser automation | separate from generic web fetch |
| `packages/pi-editor-tools` | `vim-lite` | editor extension, not web access |
| `packages/pi-cockpit` | `agent-cockpit*` | orchestration/control-plane work |
| `packages/computer-use` | CuaDriver wrapper + `macos-computer-use` | native macOS UI testing lane |
| private `pi-personal-core-skills` repo | commit/uv/tmux/etc. skills | replace global skill sprawl outside this monorepo |

Do this after resource hygiene so package moves do not compound startup confusion.

### 3. Decide what belongs in this monorepo

Keep in this repo for now:

- Pi extensions/tools used by Arthur daily.
- Slotok / UGC / Jimeng / archive experiments while they share schemas and provider infrastructure.
- Dynamic workflows and Symphony Lite while they are actively co-evolving with Pi.

Candidates to split later:

- `twitter-archive` + `tweet-viewer` if it becomes a standalone archive product.
- `jimeng-client` if it becomes a reusable provider adapter.
- `ugc-cli` / Slotok if it becomes the main app/product.
- Personal/global skills if they become a separate private package.

### 4. Orchestration backlog

From `docs/plans/symphony-lite.md`, `docs/plans/pi-agent-control-plane.md`, and the coordination runbook:

1. Add a repo-wide SQLite task ledger for packet status, owner paths, proof links, assignment records, and scheduling timestamps.
2. Keep Markdown as the policy/rationale/proof-note layer; explicitly avoid migrating every small Markdown file in the first pass.
3. Seed the ledger from `TASKS.md` rows, then add proof links to existing QA notes and session logs only when they affect review or scheduling.
4. Persist workflow/run records instead of in-memory-only workflow subagents.
5. Add `ask_arthur` / human-in-loop queue.
6. Add reviewer personas and tool profiles.
7. Add child Pi/Codex session spawning with cockpit registration.
8. Keep tmux/Zellij as optional materialization, not source of truth.

### 5. Slotok / AI UGC backlog

From `docs/plans/slotok-workbench.md` and UGC/provider docs:

1. Build Bun daemon MVP over existing eval/artifact data.
2. Build Solid/Electron shell around run list, element list, JSON/detail panes, notes.
3. Formalize pipeline element schema and artifact registry.
4. Keep provider runs dry-run/concurrency-safe first; live Jimeng/Dreamina can spend quota.
5. Move one-off media diagnostic scripts into `packages/ugc-cli` or delete them.

## Suggested next commit chunks

1. `chore(pi): vendor codex plugin router skills`
   - `.pi/extensions/codex-plugin-manager/index.ts`
   - `.gitignore` exceptions
   - `vendor/openai/README.md`
   - `vendor/openai/codex-plugin-catalog.json`
   - `vendor/openai/codex-plugin-router-skills/**`

2. `chore(skills): add personal core skill package`
   - superseded by private `pi-personal-core-skills` repo

3. `docs(repo): consolidate cleanup backlog`
   - this doc
   - resource inventory doc
   - update `TECH_DEBT.md`

4. Done separately:
   - `chore(pi): replace broad global skill package`
   - `~/.pi/agent/settings.json` now uses the private skills repo

5. Remaining:
   - remove stale skill symlinks/checkouts
   - decide/move/delete `scripts/imagegen-observe.py`
