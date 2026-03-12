# @wirebabel/legacy-web-access

Legacy reference package for the pre-Effect implementation.

## Status

- Reference/debug only during the migration.
- Not the primary extension entrypoint.
- Prefer changes in `src/effect/*` instead.

## Editing policy

Avoid changing files in `packages/legacy-web-access/src/*` unless the task explicitly targets legacy parity/debugging.

If new shared behavior is needed, prefer extracting it into an Effect-owned or neutral shared module and letting legacy delegate, rather than growing new logic here.

Current default Pi extension entrypoint:

- `src/effect/index.ts`

Legacy entrypoint retained only for reference/parity work:

- `packages/legacy-web-access/src/index.ts`
