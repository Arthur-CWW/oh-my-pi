# Effect TS Migration Spec (Incremental, Dual-Run)

## Goals

1. Migrate from ad-hoc async/throw code to **Effect TS** with typed errors.
2. Add local-first observability for debugging by agent/human.
3. Keep current implementation working while migrating.
4. Validate each migration step with tests and smoke checks.
5. Avoid collapsing errors into generic messages.

## Non-Goals (for now)

- Deployment observability stacks (SaaS, cloud traces)
- External DBs (Postgres, etc.)
- FEST/VEST client refactors

---

## Current Repo Organization (after prep)

- `src/old/*` → current implementation (source of truth during migration)
- `src/effect/*` → new Effect TS implementation
- `tests/*` → boundary-focused tests (Bun)
- `scripts/*` → e2e smoke scripts (cookies/search)

Pi extension entry (current): `src/old/index.ts`

---

## Migration Strategy

### Phase 0 — Baseline (now)

- Keep old implementation runnable.
- Add tests for stable boundaries.
- Add bug ledger of known issues.
- Add smoke scripts and artifact outputs.

### Phase 1 — Effect Foundation

Create foundational Effect modules under `src/effect/core`:

- `Config.ts` (typed config/env parsing)
- `Errors.ts` (tagged error ADTs)
- `Http.ts` (fetch wrapper with retries/timeouts)
- `Fs.ts` (filesystem service)
- `Clock.ts`, `Random.ts` (if needed)
- `Observability.ts` (event sink API)

### Phase 2 — Local Observability + Event Sourcing

- SQLite event store (`src/effect/observability/EventStore.ts`)
- Structured event model (JSON serializable)
- Correlation IDs per request/tool execution
- Log both success/failure with typed cause

Event examples:

- `SearchRequested`
- `ProviderSelected`
- `ProviderAttempted`
- `ProviderFailed`
- `ContentFetched`
- `FallbackAttempted`
- `FallbackSucceeded`
- `ToolCompleted`

### Phase 3 — Migrate by Vertical Slices

Migrate one bounded flow at a time:

1. `gemini-search`
2. `perplexity`
3. `fetch/extract` pipeline
4. youtube/video/github special cases

For each slice:

- Keep old API-compatible adapter
- Add contract tests (same input, same output shape)
- Dual-run optional (old + new) for comparison in debug mode

### Phase 4 — Switch Over

- Swap Pi entry from `src/old/index.ts` to `src/effect/index.ts`
- Keep `src/old` for one release window
- Remove old after parity confidence

---

## Validation Gates (must pass before next phase)

### Gate A (foundation)

- `bun run test` green
- `bun run typecheck` green (excluding old index only)
- E2E cookie/search scripts pass on maintainer machine

### Gate B (per-slice)

For each migrated slice:

- unit/contract tests pass
- golden snapshot tests pass (response shapes/content excerpts)
- no regression in e2e smoke suite
- events written to sqlite for both success/failure paths

### Gate C (cutover)

- Old/new parity checklist complete
- Flake rate acceptable across repeated runs
- Key errors now typed + surfaced with actionable details

---

## Testing Policy

Focus on **boundary behavior**, not internals:

- input/output contracts
- provider fallback behavior
- error mapping behavior
- deterministic formatting/parsing

Add snapshot tests for:

- normalized tool outputs
- condensed search summaries
- selected markdown extraction transforms

---

## Known Issues / Bug Ledger (baseline)

1. Pi extension typing drift in `src/old/index.ts` (strict TS fails if included).
2. Gemini cookie path can be flaky in some environments (historical issue #2 with `node:sqlite` loader contexts).
3. Diagnostics are often collapsed; some flows still return generic fallback errors.
4. Lint warnings remain in old codebase (style + strictness), to be addressed during slice migration.
5. Intermittent Gemini search e2e flake observed (2026-02-19): first run failed with `Gemini search unavailable` despite cookies present; immediate retry passed. Artifacts retained in `test-output/`.
6. Intermittent Effect Gemini search e2e flake observed (2026-02-19): first run of `test:e2e:search:gemini:effect` failed with `Gemini search unavailable`; immediate retry passed. Artifacts retained in `test-output/`.

### Manual smoke notes (current machine)

- Gemini search (10/10 loops): passed.
- Cookie-auth e2e (6/6 loops): passed.
- `extractContent` HTTP/GitHub/YouTube/local-video sample runs: passed.

---

## Effect TS Design Conventions

- No `any`
- Tagged error channels (never plain string throws in core)
- All side effects behind services/layers
- Use `Effect.log*` + event store writer for breadcrumbs
- Keep adapters thin at tool boundary

---

## Open Questions

1. Should sqlite events be append-only forever, or with retention policy?
2. Do we want dual-run in dev only, or also in normal mode with sampling?
3. Snapshot approval workflow: auto-update or explicit review command?
4. Preferred sqlite library under Bun + Effect runtime?

---

## Immediate Next Tasks

1. Add Effect deps + base modules under `src/effect/core`.
2. Implement `EventStore` (sqlite) + `Observability` service.
3. Migrate `gemini-search` as first vertical slice with parity tests.
4. Add snapshot tests for search output normalization.
