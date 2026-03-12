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

## Working folder layout (current direction)

- `packages/legacy-web-access/src/*` legacy implementation retained for parity/debug behind its own package boundary
- `src/effect/core/*` shared config helpers only where standard Effect APIs are not enough
- `src/effect/observability/*` sqlite event store only; shared event typing lives in flat Effect modules when practical
- `src/effect/*.ts` flattened Effect slices when practical (per repo preference)
- `src/effect/index.ts` current extension entrypoint

## Migration operating mode

- Package entry now points to `src/effect/index.ts`.
- Effect entrypoint currently keeps a compatibility bridge to legacy tool registration for behavior parity.
- Replace bridge incrementally by migrating remaining slices into Effect modules.
- Validate each slice via tests + smoke scripts + snapshots before removing bridge paths.
