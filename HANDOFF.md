# Handoff (Migration Context)

_Last updated: 2026-03-12_

## What was completed in this pass

1. **Remaining fetch-content legacy extractor dependency removed**
   - `src/effect/fetch-content-runtime.ts` no longer imports `packages/legacy-web-access/src/extract.js`.
   - Added Effect-owned extractor modules:
     - `src/effect/github-api.ts`
     - `src/effect/github-extract.ts`
     - `src/effect/pdf-extract.ts`
     - `src/effect/video-extract.ts`
     - `src/effect/youtube-extract.ts`
   - Added shared schema/config helpers:
     - `src/shared/fetch-content-contracts.ts`
     - `src/effect/fetch-content-config.ts`
     - `src/effect/fetch-content-utils.ts`

2. **Default Effect entrypoint is now bridge-free**
   - Removed the legacy registrar / bridge from `src/effect/index.ts`.
   - The default entrypoint now registers only the Effect-owned tool surface.
   - Added an Effect-owned `/search` command for browsing stored search/fetch results.
   - The legacy `/websearch` browser-curation flow and activity widget remain reference-only under `packages/legacy-web-access/src/index.ts`.

3. **Legacy/reference tests moved out of top-level `tests/`**
   - Moved legacy/reference-only tests to `packages/legacy-web-access/test/*`.
   - Moved legacy snapshots to `packages/legacy-web-access/test/snapshots/*`.
   - Updated TS include lists so the legacy package test folder is typechecked.

4. **Legacy package marked reference-only**
   - Added `packages/legacy-web-access/README.md` explaining that legacy code is retained for parity/debug reference and should not be modified unless explicitly needed.

5. **Repo guidance/preferences updated**
   - `AGENTS.md` now explicitly records:
     - prefer Effect `Schema` for parsing/serialization work when practical
     - treat `packages/legacy-web-access/*` as reference-only by default

## Current architecture

- Default extension entrypoint: `src/effect/index.ts`
- Legacy reference/debug package: `packages/legacy-web-access/src/*`
- Effect fetch-content runtime special cases are now local to `src/effect/*`
- Shared stored-result helpers remain in `src/shared/stored-results.ts`
- Shared fetch-content contracts now live in `src/shared/fetch-content-contracts.ts`

## Validation commands run in the latest pass

```bash
bun run typecheck
bun run test
bun run test:e2e:cookies
bun run test:e2e:search:gemini
pi --no-extensions -e ./src/effect/index.ts --help
```

## Latest validation status

- ✅ `bun run typecheck`
- ✅ `bun run test`
- ✅ `bun run test:e2e:cookies`
- ❌ `bun run test:e2e:search:gemini` (blocked by missing Gemini auth/API in this environment)
- ✅ `pi --no-extensions -e ./src/effect/index.ts --help`

## Important docs to start next session

- `AGENTS.md`
- `task-tracker.md`
- `docs/migration-context.md`
- `docs/migration-spec.md`
- `docs/effect-migration-prep.md`
- `docs/references/effect-llms.txt`
- `packages/legacy-web-access/README.md`

## Recommended next task

1. Split `src/effect/index.ts` further now that tool + command registration are fully Effect-owned.
2. Tighten the schema/config/error boundaries around the new Effect-owned fetch special-case modules:
   - `src/effect/github-extract.ts`
   - `src/effect/pdf-extract.ts`
   - `src/effect/video-extract.ts`
   - `src/effect/youtube-extract.ts`
3. Keep `packages/legacy-web-access/*` stable/reference-only unless a parity/debug fix explicitly requires touching it.
