# AGENTS.md

## Purpose

This repo is migrating from the legacy implementation to an Effect TS implementation **without breaking behavior**.

- Legacy implementation: `src/old/*`
- New implementation (in progress): `src/effect/*`

Current Pi extension entrypoint:
- `package.json -> pi.extensions[0] = ./src/old/index.ts`

## Ground Rules

1. **No `any` types** in new or modified code.
2. Keep migration incremental and reversible.
3. Prefer boundary/contract tests over implementation-detail tests.
4. Preserve current behavior unless explicitly changing spec.
5. Keep observability local-first (SQLite event log planned in Effect layer).

## Persistent User Preferences (Self-Healing)

When the user states a repo-wide preference (code style, structure, testing workflow, migration workflow), treat it as persistent across sessions and update this file immediately.

Rules:
1. Apply the preference in the current change.
2. Update `AGENTS.md` in the same task so future sessions inherit it.
3. Prefer updating existing preference bullets rather than duplicating/conflicting rules.

Current persistent preferences:
- Prefer a **compressed/flat file layout** for new Effect slices when practical.
- Avoid unnecessary nested folders + `index.ts` re-export barrels for single-feature modules.
- If splitting into multiple files is necessary, keep it minimal and justify briefly in PR/task notes.

## Mandatory Validation After Every Change

Run all commands below and ensure they pass before finishing work.

**Feature rule (strict):** If you add or change a feature, you must add or update at least one test that validates that feature's behavior. Then run that test (plus full test suite) before finishing.

```bash
bun run typecheck
bun run test
bun run test:e2e:cookies
bun run test:e2e:search:gemini
pi --no-extensions -e ./src/old/index.ts --help
```

Notes:
- `test:e2e:search:gemini` writes artifacts into `test-output/`.
- If e2e fails intermittently, keep artifacts and record failures in `docs/migration-spec.md` bug ledger.
- When changing `src/effect/*` entry/CLI behavior, also validate Effect CLI loading (e.g. `pi --no-extensions -e ./src/effect/index.ts --help` or `bun run test:e2e:effect:help`).

## Testing Scope

### Existing automated tests (`tests/`)
- URL parsing boundaries
- utility functions
- storage behavior
- search-filter behavior
- video file detection
- RSC guard behavior

### Existing smoke scripts (`scripts/`)
- Chrome cookie auth path
- Gemini search end-to-end path

## Migration Process

Follow `docs/migration-spec.md`:
1. Foundation (Effect core)
2. Local observability (SQLite event store)
3. Vertical slice migrations (search first)
4. Cutover to `src/effect/index.ts`

Keep `src/old` intact until parity checks pass.

## Key Project Docs

- Migration spec: `docs/migration-spec.md`
- Migration prep: `docs/effect-migration-prep.md`
- Effect reference snapshot: `docs/references/effect-llms.txt`
- Session handoff context: `docs/migration-context.md`
- Running migration tracker: `task-tracker.md` (repo root)

## Task Tracking & Completion Workflow

Use `task-tracker.md` as the single source of truth for migration progress.

Task state format is symbol-only. See `task-tracker.md` legend at the top.

Rules:
1. Start work by moving one task to `[@]`.
2. When implementation + tests are complete, mark `[@User]` and add a short result note.
3. User confirms, then set `[x]`.
4. Keep tasks small and boundary-focused.

After finishing each task, provide a brief summary in chat: **Done / Not done / Risks**.

## When Adding New Features During Migration

- Implement in `src/effect/*` (unless required hotfix in old path)
- Add/adjust tests first when possible
- **Never merge a feature without a test that covers it** (unit/contract/snapshot/e2e as appropriate)
- Run the specific new/updated test(s) and then run full `bun run test`
- Add structured errors (typed) instead of generic string errors
- Emit observable events (once EventStore is introduced)
