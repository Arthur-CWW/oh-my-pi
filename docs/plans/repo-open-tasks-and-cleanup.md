# Repo Open Tasks and Cleanup Plan

Date: 2026-06-09; Last updated: 2026-06-24

## Current diagnosis

This repo has become a personal Pi platform monorepo, not just `pi-web-access`:

- web search/fetch/browser/LLM frontend tools
- local Pi skills and prompt templates
- Codex plugin experiments
- CuaDriver / `computer_use` GUI automation notes
- Slotok / AI UGC / Jimeng / Twitter archive apps and packages
- local orchestration/cockpit prototypes

That is fine for exploration, but it needs sharper package boundaries and fewer globally loaded resources.

## Immediate repo state

Clean committed baseline exists for:

- CuaDriver / `computer_use` docs and skill.
- Project skill curation: `dreamina-cli` removed; root/web-access manifests no longer load every skill folder.
- Top-level `TECH_DEBT.md`.
- AltTab CuaDriver hide setting note.

Tracker sync after ASMR review-fix commit `cacf7653`:

- ASMR companion / Seedance is done; reviewer proof docs are `docs/qa/asmr-companion-goal6-final-handoff-20260624.md` and `docs/qa/asmr-companion-goal6-artifact-inventory-20260624.json`, with regenerable proof roots under `data/asmr-companion/goal2/seedance-parent-proof/`, `data/asmr-companion/goal3-spatial-proof/`, `data/asmr-companion/goal4-planning/`, and `data/asmr-companion/goal5-pipeline-proof/`.
- Codex plugin manager/router vendor work and the private `pi-personal-core-skills` replacement are marked done in the sequence below; they are no longer immediate dirty/pending tracker items.
- T-2026-06-09-007 repo-local stale skill checkouts/symlinks are closed. Remaining outside this repo: archive or remove `/Users/arthur/.pi/skills/pi-skills/` after deciding whether its `browser-tools/output/jimeng-lab/raw/` captures are needed.

## What to do next

### 1. Finish resource hygiene first

Goal: Pi startup should only show skills that are intentionally global for Arthur or intentionally project-local.

Recommended sequence:

1. Track the Codex plugin manager and the small router-skill vendor subset. Done.
2. Create and install private `pi-personal-core-skills` repo as the replacement for noisy global `agent-stuff`. Done.
3. Vendor full `agent-stuff` source as reference under `vendor/mitsuhiko/agent-stuff`. Done.
4. Update `~/.pi/agent/settings.json` to remove broad `git:github.com/mitsuhiko/agent-stuff` and replace it with `git:git@github.com:Arthur-CWW/pi-personal-core-skills@main`. Done.
5. Remove the temporary in-monorepo `packages/personal-core-skills` copy. Done.
6. Decide whether `scripts/imagegen-observe.py` belongs in `packages/ugc-cli`, `scripts/diagnostics/`, or should be deleted. Done on 2026-06-13; the standalone wrapper was deleted rather than moved.
7. Regroup first-party skills and remove stale local skill checkouts. Repo-local cleanup done by 2026-06-24:
   - moved first-party repo skills to grouped `skills/{core,browser,provider,research,design,media}/`
   - moved ignored root `chrome-devtools-mcp/` checkout to `vendor/chrome-devtools-mcp/`
   - removed empty `deterministic-simulation-testing/`, `packages/personal-core-skills/`, and the now-empty `packages/web-access/skills/` directory
   - remaining outside this repo: archive or remove `/Users/arthur/.pi/skills/pi-skills/` after deciding whether its `browser-tools/output/jimeng-lab/raw/` captures are needed

### 2. Split `packages/web-access`

`packages/web-access` is still the root Pi extension seam for web search plus several pre-split tool families. T-2026-06-09-005 cleanup should keep this seam explicit until dedicated package moves happen.

Current no-move boundary note:

- Root Pi intentionally loads `packages/web-access/src/index.ts`.
- `packages/web-access/package.json` documents the transitional host role and the target boundary.
- `packages/web-access/src/index.ts` is the registration seam; keep candidate packages isolated behind `register*` calls until a migration slice moves files.
- Reviewer rerun command from repo root: `bun run web-access:boundary:check`.

Recommended package boundaries:

| Future package | Move from `web-access` | Why |
|---|---|---|
| `packages/web-access` | search/fetch/cookies/YouTube only | keep name honest |
| `packages/frontend-llm-browser` | ChatGPT/AI Studio/Grok frontend browser automation | separate from generic web fetch |
| `packages/pi-editor-tools` | `vim-lite` | editor extension, not web access |
| `packages/pi-cockpit` | `agent-cockpit*` | orchestration/control-plane work |
| `packages/computer-use` | CuaDriver wrapper + `cua-driver` skill | native macOS UI testing lane |
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

From `docs/plans/symphony-lite.md`, `docs/plans/pi-agent-control-plane.md`, the coordination runbook, and the repo-wide packet SOP in `docs/plans/new-workstream-subagent-packets.md#repo-wide-packet-workerreviewer-sop`:

1. Add a repo-wide SQLite task ledger for packet status, owner paths, excluded paths, proof links, assignment records, reviewer persona, root-run validation commands, and scheduling timestamps.
2. Keep Markdown as the policy/rationale/proof-note layer; explicitly avoid migrating every small Markdown file in the first pass.
3. Seed the ledger from `TASKS.md` rows, then add proof links to existing QA notes and session logs only when they affect review or scheduling.
4. Persist workflow/run records instead of in-memory-only workflow subagents.
5. Add `ask_arthur` / human-in-loop queue.
6. Add reviewer personas and tool profiles matching the SOP splits: API/contract, provider access and cost/auth, runtime/package boundaries, UX/media, proof/QA, and repo hygiene.
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

1. Done separately:
   - `chore(pi): vendor codex plugin router skills`
   - `chore(pi): replace broad global skill package`
   - `docs(repo): consolidate cleanup backlog`
   - `~/.pi/agent/settings.json` now uses the private skills repo

2. Remaining:
   - archive or remove `/Users/arthur/.pi/skills/pi-skills/` after preserving any needed `browser-tools/output/jimeng-lab/raw/` captures
   - split `packages/web-access` only when T-2026-06-09-005 resumes; do not mix package moves into stale-checkout cleanup
