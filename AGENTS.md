# AGENTS.md

## What this is

`~/agents` — agent control plane monorepo: OMP harness, Pi extensions, skills, and four product streams (companion, playground, primer, harness). Each stream owns a slice of the repo; read your stream's `GOAL.md` before working.

## Build and verify

```bash
bun run check                     # typecheck + tests + lint (the gate)
bun run typecheck                 # packages/web-access
bun run test                      # packages/web-access
bun run lint                      # all guardrails
bun run lint:unsafe-types         # no any/unknown ratchet
bun run jimeng:test               # jimeng-client unit tests
bun run dynamic-workflows:test    # workflow parser/runtime
```

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
- **Proof artifacts** for substantial work: screenshots, logs, fixtures, rerun commands (`proof-of-work-qa` skill).

## Review surfaces (Arthur, 2026-07-03 — repeatable patterns)

- **Bret Victor rule.** Artifacts show the *behavior itself* and invite direct manipulation — playable, draggable, runnable in place. A number or a static file is a failure when the thing itself could be experienced. Design every proof asking: "can Arthur *feel* this in one click?"
- **Portless per stream.** Every stream's review surface is a self-contained local app behind a stable name: `bunx portless <name> <cmd>` → `http://<name>.localhost:1355`. No port numbers, no collisions across parallel OMP sessions.
- **Artifact-viewer/dashboard pattern.** Finished work → entry in a feed ledger (JSONL + schema) → live dashboard card with inline media, runnable actions, and **error logs of every run**. Taste forks → `question` entries answered in-place. Arthur reviews products, not commits. Reference implementations: `apps/xanadu` (companion), `packages/primer-daemon` dashboard (primer) — converge these into a shared package when a third consumer appears.
- **One error log per app.** Backend errors AND browser errors (`window.onerror`/`unhandledrejection` POSTed to the app server) append to a single `data/<app>/errors.log`. Before claiming any UI/server work done, READ that file — "done" with fresh errors in the log is not done.
- **Dev server always running.** The active stream keeps its dashboard/dev server up in the background so Arthur can glance anytime — supervised: a `dev:up` restart-loop script + `bun --watch` hot reload + a `/healthz` route (see `apps/scene-playground/scripts/dev-up.sh`). Never QA against Arthur's live instance — boot your own.
- **Delegate the checking.** Browser QA, code review, and verification runs happen in subagents (GPT-5.5 for pedantic code review; GPT/Kimi lanes for computer-use QA), never in the orchestrator's main thread.

## Hard rules

- **No `sudo`** without Arthur's explicit approval via `ask` (exact command, cwd, why, reversibility).
- **Fable 5 quota is finite and dying** (~24% left, gone after 2026-07-08): NEVER launch `claude-fable-5` at high thinking — **medium only**, creative work only. Constrained tasks go to gpt/kimi lanes. This mistake keeps recurring — check `--thinking` before every fable launch.
- **No secrets in commits.** No `.env`, tokens, credentials, session files.
- **Provider spend gates.** Jimeng/Dreamina: dry-run default, live spend only inside a named cap with approval; concurrency 1; stop on rate-limit errors.
- **Respectful external access.** Low concurrency, jitter/backoff, disk cache, entity dedupe. No private/locked content.

## Orientation

| What | Where |
|---|---|
| Stream goals and ownership | `streams/companion/GOAL.md`, `streams/playground/GOAL.md`, `streams/primer/GOAL.md`, `streams/harness/GOAL.md` |
| Charter (priorities, routing, taste, contracts) | `docs/fable/charter.md` |
| Locator (code, artifacts, config, sessions) | `docs/fable/atlas.md` |
| Creative direction | `docs/state/creative-framing.md` |
| Harness design brief | `docs/fable/harness-brief.md` |
| State docs | `docs/state/README.md` |
