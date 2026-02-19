# Migration Task Tracker

_Last updated: 2026-02-19_

State legend (symbol-only):
- `[ ]` Open
- `[@]` Ongoing
- `[@User]` Checking (awaiting user validation)
- `[x]` Checked
- `[~]` Obsolete
- `[?]` In Question

## Tasks

- [x] Create migration baseline (old/new folder split, docs, handoff context).
- [x] Add initial boundary tests and e2e smoke scripts.
- [x] Enforce no-`any` rule in agent instructions and testing expectations.
- [x] Add running task workflow to AGENTS.md and create this tracker.
  - Result: tracker + state model added; awaiting your confirmation to mark checked.

- [@User] Add Effect TS dependencies and scaffold core modules (`Config`, `Errors`, `Http`, `Observability`) with tests.
  - Result: Added `effect`, `@effect/schema`, `@effect/platform`, `@effect/platform-node`; created `src/effect/core/{Config,Errors,Http,Observability,index}.ts`; added `tests/effect-core.test.ts`; all mandatory validation commands passed. Session ID: not exposed by this harness/session context. pi-session-2026-02-19T01-09-54-465Z_076c7e4b-6c1d-489a-9a51-57fe1c707f3a.html
- [x] Implement local SQLite event store for structured event sourcing in `src/effect`.
  - Result: Added `src/effect/observability/EventStore.ts` (+ index) with SQLite-backed append/list APIs, bun/node sqlite driver fallback, schema + indexes, and typed `EventStoreError` handling; added `tests/event-store.test.ts`; mandatory validation commands passed.
- [ ] Migrate `gemini-search` to Effect vertical slice with parity tests against `src/old` behavior.
- [ ] Add snapshot tests for stable boundary outputs (search normalization / condensed summaries).
- [@User] Wire `src/effect/index.ts` shadow entry for non-production dry runs.
  - Result: Added `src/effect/index.ts` shadow extension with `effect_event_store_smoke` tool (exercises Effect SQLite event store), added `tests/effect-index.test.ts`, and added `test:e2e:effect:help` script to validate CLI loading via `pi --no-extensions -e ./src/effect/index.ts --help`; validations passed (Gemini e2e passed on retry after one transient failure).
- [ ] Cut over extension entrypoint from `src/old/index.ts` to `src/effect/index.ts` after parity.
