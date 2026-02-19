# Migration Task Tracker

_Last updated: 2026-02-19_

## State Legend

- `- [ ] [TODO] ...`
- `- [ ] [IN_PROGRESS] ...`
- `- [ ] [BLOCKED] ...`
- `- [x] [READY_FOR_USER_CHECK] ...`
- `- [x] [DONE] ...`

## Tasks

- [x] [DONE] Create migration baseline (old/new folder split, docs, handoff context).
- [x] [DONE] Add initial boundary tests and e2e smoke scripts.
- [x] [DONE] Enforce no-`any` rule in agent instructions and testing expectations.
- [x] [READY_FOR_USER_CHECK] Add running task workflow to AGENTS.md and create this tracker.
  - Result: tracker + state model added; awaiting your confirmation to mark DONE.

- [ ] [TODO] Add Effect TS dependencies and scaffold core modules (`Config`, `Errors`, `Http`, `Observability`) with tests.
- [ ] [TODO] Implement local SQLite event store for structured event sourcing in `src/effect`.
- [ ] [TODO] Migrate `gemini-search` to Effect vertical slice with parity tests against `src/old` behavior.
- [ ] [TODO] Add snapshot tests for stable boundary outputs (search normalization / condensed summaries).
- [ ] [TODO] Wire `src/effect/index.ts` shadow entry for non-production dry runs.
- [ ] [TODO] Cut over extension entrypoint from `src/old/index.ts` to `src/effect/index.ts` after parity.
