# AGENTS.md

## What this is

`~/agents` — agent control plane monorepo: OMP harness, Pi extensions, skills, and four product streams (companion, playground, primer, harness). Each stream owns a slice of the repo; read your stream's `GOAL.md` before working.

## Epistemics (read `docs/fable/epistemics.md` — the covenant)

Docs here are testimony, not ground truth; most were written by agents and decay. The compressed rules:

- **Config beats doc.** Model/lane/quota facts live in `.omp/*.yml`, `~/.omp/agent/config.yml`, `docs/state/model-availability.md`. Prose that restates them is stale by default — on conflict, the live file wins; flag the doc. Never write such snapshots into docs: link, never restate.
- **Handoffs are messages, not law.** Highest-dated `HANDOFF-LIVE-*.md` is live; superseded or >7-day-old handoffs are history. Treat their routing/status claims as archaeology.
- **Utterance ≠ preference.** When Arthur states a preference, record the generator (why + scope + date + provenance tier A/A~/I/M), not the bare sentence. Push back for real — name what would falsify the claim — and ask degree-of-truth before absolutizing a one-incident reaction into law.
- **Band-aids die with the model.** Rules that exist because some model kept erring go down the guardrail ladder (lint/ratchet/runtime reminder), not into docs; if unavoidable, name the model and date it.
- **Retire as you write.** Touching a ledger (TASKS.md, friction, INDEX) includes flagging rows you can see are dead. Append-only is rot.

## Build and verify

```bash
bun run check                     # typecheck + tests + lint (the gate)
bun run typecheck                 # legacy root chain (~17 packages) — new packages self-gate in-package
bun run test                      # legacy root chain (~17 packages)
bun run lint                      # all guardrails (unsafe-types, ast-grep, ratchets)
```

New/touched packages: `cd <pkg> && bun run check` (self-contained packages rule below).

## Code rules

Invariants. Most are also static lints — push every lesson down the guardrail ladder.

- **No `any`/`unknown`/`Any`** outside typed boundary modules. `bun run lint:unsafe-types`.
- **Schema at boundaries.** External data (API, file, process, CLI) decoded with Effect Schema before entering core code. No raw `JSON.parse`; no untyped DB rows.
- **Effect v4.** `Effect.fn` (let inference work), `Schema.TaggedErrorClass`, `Effect.retry(Schedule.recurs(1))`, `Effect.runPromise` only at Pi harness boundary. Effect CLI for new command surfaces.
- **Module resolution**: `bundler` — no `.js` import extensions.
- **Tests**: `test/` dirs close to source, never colocated `*.test.ts`. Test behavior, not defaults. No mocks.
- **React UI**: test state/view models and interaction, not rendered markup. Visual/browser QA for UI.
- **Cross-runtime**: avoid native modules unless deliberately isolated. `bun-types` in typecheck configs.
- **Self-contained packages** (Arthur, 2026-07-03). Each app/package owns its scripts, deps, and run commands in its OWN `package.json`; NEVER add new scripts or deps to the root `package.json`. Existing root entries are legacy — migrate them into their package when you next touch that package, don't extend them. Run docs say `cd <pkg> && bun run dev`, not root aliases.
- **Vanilla UI perf** (earned 2026-07-03): virtualize large grids/lists with `@tanstack/virtual-core` (framework-agnostic; works clean in vanilla TS). Navigation/selection updates patch CSS classes on stable DOM — NEVER rebuild a media grid on keynav (recreated `<video>` elements = reload flashes). Cap live media elements (~2); offscreen cells are placeholders. React/React-compiler/Million evaluated and not adopted for vanilla apps.

## Coordination

- **Streams own paths.** `streams/<x>/GOAL.md` declares owner and excluded paths. Stay inside yours; cross-stream reusables graduate to `packages/`.
- **TASKS.md** tracks multi-step work. Update when status changes.
- **Subagent packets**: owner paths, excluded paths, model lane, acceptance criteria, non-goals. Workers skip formatters/linters — the coordinator gates.
- **Landing-first workers** (earned 2026-07-19, ~5 landings lost to wall-timeouts): a worker writes its ledger/receipt updates BEFORE final verification passes, so a timeout never orphans finished work. Coordinators pass predecessor transcripts (`history://<id>`) into successor assignments instead of letting them re-scout, and size implementation lanes ≥25min (`timeoutSec`).
- **Changeset-first workers** (Arthur, 2026-07-20). In a colocated jj repository, every writable worker owns one described behavioral change and returns its change ID; it NEVER moves shared bookmarks. Keep the existing stream/path ownership convention and avoid a permanent workspace per stream. The coordinator provisions a dedicated workspace only when concurrent filesystem isolation is actually required; otherwise isolated workers return patches that the coordinator imports into named sibling/stacked changes. The coordinator rebases/integrates changes, runs union gates, then advances a Git-visible bookmark.
- **Writable-task start invariant.** Before the first edit, resolve the canonical repository with `jj root`, inspect `jj status`, and create/describe one behavioral change with `jj new -m "<scope>: <behavior>"`. NEVER use a dirty shared `@` as a scratchpad or let concurrent writers share it. If unrelated work already occupies `@`, use an isolated worker patch or a dedicated `jj workspace`; give every writable packet its workspace/change ID.
- **Checkpoint before divergence.** Put experiments, architecture pivots, and live-deployment repairs in child changes before changing source. A failed spike is `jj abandon <change>`; a successful dependency is stacked/rebased and later squashed deliberately. Use `jj split` early for path-disjoint work, not as post-hoc recovery after multiple behaviors have been interleaved in the same lines. Before editing a mirror/worktree under `local/`, resolve and change the canonical tracked repository instead.
- **Proof artifacts** for substantial work: screenshots, logs, fixtures, rerun commands (`proof-of-work-qa` skill).

## Review surfaces (Arthur, 2026-07-03 — repeatable patterns)

- **Adaptive desktop worlds.** Desktop UI uses the full available window and adapts to whatever desktop viewport exists. Knowledge worlds/canvases may extend arbitrarily beyond the viewport in both axes; pan/scroll handles both axes. `1440x900` is baseline QA only, never a design target, cap, or world bound. Fixed viewport values are initial measurement fallbacks before `ResizeObserver`, never layout authority.
- **Bret Victor rule.** Artifacts show the *behavior itself* and invite direct manipulation — playable, draggable, runnable in place. A number or a static file is a failure when the thing itself could be experienced. Design every proof asking: "can Arthur *feel* this in one click?"
- **Portless per stream.** Every stream's review surface is a self-contained local app behind a stable name: `bunx portless <name> <cmd>` → `http://<name>.localhost:1355`. No port numbers, no collisions across parallel OMP sessions.
- **Artifact-viewer/dashboard pattern.** Finished work → entry in a feed ledger (JSONL + schema) → live dashboard card with inline media, runnable actions, and **error logs of every run**. Taste forks → `question` entries answered in-place. Arthur reviews products, not commits. Reference implementations: `apps/xanadu` (companion), `packages/primer-daemon` dashboard (primer) — converge these into a shared package when a third consumer appears.
- **One error log per app.** Backend errors AND browser errors (`window.onerror`/`unhandledrejection` POSTed to the app server) append to a single `data/<app>/errors.log`. Before claiming any UI/server work done, READ that file — "done" with fresh errors in the log is not done.
- **Dev server always running.** The active stream keeps its dashboard/dev server up in the background so Arthur can glance anytime — supervised: a `dev:up` restart-loop script + `bun --watch` hot reload + a `/healthz` route (see `apps/scene-playground/scripts/dev-up.sh`). Never QA against Arthur's live instance — boot your own.
- **Delegate the checking.** Browser QA, code review, and verification runs happen in subagents using the appropriate configured role, never in the orchestrator's main thread.

## Hard rules

- **No `sudo`** without Arthur's explicit approval via `ask` (exact command, cwd, why, reversibility).
- **Model routing.** Never spawn Fable subagents (orchestrator-only; hard-guarded in the model resolver). **Never route to Terra** (Arthur, 2026-07-15: "not pareto-efficient at anything"). Lane assignments are NOT cached here: resolve each responsibility from live config and `docs/fable/routing-doctrine.md`; posture history lives in `docs/fable/agent-stack-consolidation.md`. Until the resolver stops treating the parent session's explicit `/model` as a child override, every `task` spawn MUST pass the responsibility's resolved selector explicitly; omission silently inherits the orchestrator lane. Sol escalation requires a packet-local reason rather than task size.
- **No secrets in commits.** No `.env`, tokens, credentials, session files.
- **Provider spend gates.** Jimeng/Dreamina: dry-run default, live spend only inside a named cap with approval; concurrency 1; stop on rate-limit errors.
- **Respectful external access.** Low concurrency, jitter/backoff, disk cache, entity dedupe. No private/locked content.

## Orientation

| What | Where |
|---|---|
| Stream goals and ownership | `streams/companion/GOAL.md`, `streams/playground/GOAL.md`, `streams/primer/GOAL.md`, `streams/harness/GOAL.md` |
| Charter (priorities, routing, taste, contracts) | `docs/fable/charter.md` |
| Epistemics covenant (doc classes, provenance, staleness) | `docs/fable/epistemics.md` |
| Locator (code, artifacts, config, sessions) | `docs/fable/atlas.md` |
| Creative direction | `docs/state/creative-framing.md` |
| Harness design brief | `docs/fable/harness-brief.md` |
| State docs | `docs/state/README.md` |
