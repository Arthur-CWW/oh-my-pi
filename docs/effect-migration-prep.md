# Effect Migration Prep

## Local references added

- `docs/references/effect-llms.txt` (fetched from effect.website)
- `docs/migration-spec.md` (step-by-step migration spec)

## Why keep local docs?

Useful for:

- consistent API usage while coding offline
- giving agent-friendly context for patterns and naming
- reducing drift in Effect idioms across modules

## Suggested Effect packages (initial)

- `effect`
- `@effect/schema`
- `@effect/platform`
- `@effect/platform-node`
- sqlite binding of choice (evaluate Bun compatibility)

## Proposed folder layout

- `src/old/*` current implementation
- `src/effect/core/*` shared services (config/errors/http/fs/logging)
- `src/effect/observability/*` event types + sqlite event store
- `src/effect/search/*` migrated search providers and orchestrator
- `src/effect/extract/*` migrated content extraction pipeline
- `src/effect/index.ts` future extension entrypoint

## Migration operating mode

- Keep `src/old` as production path until parity achieved.
- Build migrated slices in `src/effect`.
- Validate each slice via tests + smoke scripts + snapshots.
