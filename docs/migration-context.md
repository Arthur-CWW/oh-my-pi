# Migration Context Handoff

This file is intended to bootstrap a new session with all relevant migration context.

## Current State

- Legacy code remains in: `src/old/*`
- Effect code lives in: `src/effect/*`
- Foundation modules exist under `src/effect/core/*`
- SQLite event store exists under `src/effect/observability/EventStore.ts`
- Gemini search slice exists in `src/effect/gemini-search.ts`
- **Package extension entry now points to `src/effect/index.ts`**
- `src/effect/index.ts` currently uses a compatibility bridge to register legacy tool surface from `src/old/index.ts`, then adds Effect-only tools (so behavior remains stable during migration)

## Why Migration

Primary goals:
1. Typed errors and better error surfaces (no generic collapse)
2. Stronger local debugging for agent/human workflows
3. Event sourcing to local SQLite for action traceability
4. Safer incremental changes with boundary tests and parity checks

## Validation Commands (current)

```bash
bun run typecheck
bun run test
bun run test:e2e:cookies
bun run test:e2e:search:gemini
bun run test:e2e:effect:help
bun run test:e2e:cookies:effect
bun run test:e2e:search:gemini:effect
pi --no-extensions -e ./src/effect/index.ts --help
pi --no-extensions -e ./src/old/index.ts --help
```

## Existing E2E Smoke

- `scripts/e2e-chrome-cookies.ts`
- `scripts/e2e-search-gemini.ts`
- `scripts/e2e-chrome-cookies-effect.ts`
- `scripts/e2e-search-gemini-effect.ts`

Search e2e outputs artifacts to `test-output/` (JSON + MD).

## Observations

- Gemini and cookie smoke tests pass on this environment, with historical intermittent Gemini flake already tracked in `docs/migration-spec.md`.
- Legacy `src/old/index.ts` has typing complexity and remains excluded from strict typecheck.
- Cutover is complete at package entrypoint level, but full migration is still in progress because the Effect entrypoint currently bridges legacy tools.

## Recommended Next Work

1. Keep cutover stable while replacing compatibility bridge incrementally.
2. Migrate remaining tool slices from legacy index into Effect-native modules:
   - `perplexity`
   - `fetch_content` / `get_search_content`
   - extractor special cases (YouTube/video/GitHub)
3. Add parity tests per migrated slice and remove bridge once parity confidence is sufficient.

## Related Docs

- `AGENTS.md`
- `task-tracker.md`
- `docs/migration-spec.md`
- `docs/effect-migration-prep.md`
- `docs/references/effect-llms.txt`
