# Handoff (Migration Context)

_Last updated: 2026-02-20_

## What was completed in this pass

1. **Production entrypoint cutover completed**
   - `package.json -> pi.extensions[0]` switched from `./src/old/index.ts` to `./src/effect/index.ts`.

2. **Effect entrypoint made production-safe with compatibility bridge**
   - `src/effect/index.ts` now attempts to load/register legacy extension (`src/old/index.ts`) first.
   - Effect-only tools are still added (`chrome_cookies`, `effect_event_store_smoke`).
   - Effect `web_search` registration is disabled when legacy tools are present to avoid clobbering legacy behavior during cutover window.

3. **Cutover contract tests added/updated**
   - `tests/effect-index.test.ts` now validates:
     - Effect tool registration (shadow path)
     - Production cutover tool surface includes legacy tools + Effect extras
     - package entrypoint points to `./src/effect/index.ts`

4. **Tracker + agent preferences updated**
   - `task-tracker.md`: cutover task moved to `[@User]` with result note.
   - `AGENTS.md`: added persistent preference that the local CLI binary is `effect-solutions` (plural).

## Current architecture

- Legacy implementation: `src/old/*` (retained for parity/debug + compatibility bridge)
- Effect implementation: `src/effect/*` (current extension entrypoint)
- Extension entry in package config: `./src/effect/index.ts`

## Validation commands run (all passed)

```bash
bun test tests/effect-index.test.ts
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

## Test status snapshot

- `bun test tests`: **36 pass, 0 fail**
- Legacy e2e cookies/search: pass
- Effect e2e cookies/search: pass
- Effect CLI load: pass
- Legacy CLI load: pass

## Files touched in this pass

- `src/effect/index.ts`
- `tests/effect-index.test.ts`
- `package.json`
- `AGENTS.md`
- `task-tracker.md`
- `src/effect/README.md`
- `docs/migration-context.md`
- `docs/migration-spec.md`
- `docs/effect-migration-prep.md`
- `HANDOFF.md`

## Important docs to start next session

- `AGENTS.md`
- `task-tracker.md`
- `docs/migration-spec.md`
- `docs/migration-context.md`
- `docs/effect-migration-prep.md`
- `docs/references/effect-llms.txt`

## Recommended next task

1. User confirm current `[@User]` tasks to move them to `[x]`.
2. Start next vertical migrations still relying on legacy bridge:
   - `perplexity`
   - `fetch_content` / `get_search_content`
   - extractor special cases (YouTube/video/GitHub) into Effect slices.
