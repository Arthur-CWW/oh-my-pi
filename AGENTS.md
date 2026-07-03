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

## Coordination

- **Streams own paths.** `streams/<x>/GOAL.md` declares owner and excluded paths. Stay inside yours; cross-stream reusables graduate to `packages/`.
- **TASKS.md** tracks multi-step work. Update when status changes.
- **Subagent packets**: owner paths, excluded paths, model lane, acceptance criteria, non-goals. Workers skip formatters/linters — the coordinator gates.
- **Proof artifacts** for substantial work: screenshots, logs, fixtures, rerun commands (`proof-of-work-qa` skill).

## Hard rules

- **No `sudo`** without Arthur's explicit approval via `ask` (exact command, cwd, why, reversibility).
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
