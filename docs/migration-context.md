# Migration Context Handoff

This file is intended to bootstrap a new session with all relevant migration context.

## Current State

- Legacy code moved to: `src/old/*`
- New Effect area scaffolded: `src/effect/*`
- Effect foundation modules added:
  - `src/effect/core/Errors.ts`
  - `src/effect/core/Config.ts`
  - `src/effect/core/Http.ts`
  - `src/effect/core/Observability.ts`
- Core barrel file added: `src/effect/core/index.ts`
- Extension still runs from: `src/old/index.ts`
- Type shims removed.
- `any` cleanup started (no explicit `any` in current checked paths).

## Why Migration

Primary goals:
1. Typed errors and better error surfaces (no generic collapse)
2. Stronger local debugging for agent/human workflows
3. Event sourcing to local SQLite for action traceability
4. Safer incremental changes with boundary tests and parity checks

## Existing Validation Commands

```bash
bun run typecheck
bun run test
bun run test:e2e:cookies
bun run test:e2e:search:gemini
pi --no-extensions -e ./src/old/index.ts --help
```

## Existing Tests

- `tests/utils.test.ts`
- `tests/parsers.test.ts`
- `tests/storage.test.ts`
- `tests/search-filter.test.ts`
- `tests/video-file.test.ts`
- `tests/rsc-extract.test.ts`
- `tests/effect-core.test.ts`

## Existing E2E Smoke

- `scripts/e2e-chrome-cookies.ts`
- `scripts/e2e-search-gemini.ts`

Search e2e outputs artifacts to `test-output/` (JSON + MD).

## Baseline Observations

- Repeated Gemini search and cookie smoke runs passed in this environment.
- Historical flakiness known around Gemini cookie/auth path in some runtime contexts.
- `src/old/index.ts` has typing complexity and should be migrated by slices instead of deep patching.

## Next Recommended Work (First Migration Slice)

1. ✅ Add Effect core modules:
   - `src/effect/core/Errors.ts`
   - `src/effect/core/Config.ts`
   - `src/effect/core/Http.ts`
   - `src/effect/core/Observability.ts`
2. Add local SQLite event store service in Effect layer.
3. Migrate `gemini-search` flow to `src/effect/search/*`.
4. Add parity/contract tests old vs new search output shape.
5. Add snapshot tests for normalized search outputs.

## Event Sourcing Direction (Local SQLite)

Planned event model examples:
- `SearchRequested`
- `ProviderSelected`
- `ProviderAttempted`
- `ProviderFailed`
- `ProviderSucceeded`
- `FallbackAttempted`
- `ToolCompleted`

Each event should include:
- `eventId`
- `timestamp`
- `correlationId`
- `sessionId` (if available)
- structured payload

## Constraints / Preferences

- Boundary testing over implementation-detail testing
- Snapshot tests acceptable and encouraged for stable boundaries
- Keep old and new implementations side-by-side until parity confidence is achieved

## Related Docs

- `AGENTS.md`
- `docs/migration-spec.md`
- `docs/effect-migration-prep.md`
- `docs/references/effect-llms.txt`
