# AGENTS.md

## Purpose

This repo is migrating from the legacy implementation to an Effect TS implementation **without breaking behavior**.

- Legacy implementation: `packages/legacy-web-access/src/*`
- New implementation (in progress): `src/effect/*`

Current Pi extension entrypoint:
- `package.json -> pi.extensions[0] = ./src/effect/index.ts`

Legacy entrypoint retained for parity/debug:
- `./packages/legacy-web-access/src/index.ts`

## Ground Rules

1. **No `any` types** in new or modified code.
2. Keep migration incremental and reversible.
3. Prefer boundary/contract tests over implementation-detail tests.
4. Preserve current behavior unless explicitly changing spec.
5. Keep observability local-first (SQLite event log planned in Effect layer).

## Effect Best Practices

**IMPORTANT:** Use the local `vendor/effect-smol` docs + source as the primary Effect reference before writing Effect code.

1. Start at `vendor/effect-smol/LLMS.md`
2. Follow the linked `ai-docs/src/*` files recursively/progressively for the topic you are touching
3. Read the corresponding real implementation/source under `vendor/effect-smol/packages/*` before locking in a pattern
4. Do **not** rely on `effect-solutions`, `node_modules`, or external Effect docs unless the user explicitly asks

Priority topics for this repo: services/layers, errors, running programs, config, testing, and CLI.

Never guess at Effect patterns - check the local effect-smol docs/source first.

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
- For Effect migrations/refactors, start from `vendor/effect-smol/LLMS.md`, follow linked docs recursively/progressively, and confirm patterns against `vendor/effect-smol/packages/*` source before implementing.
- Treat the local `vendor/effect-smol` repo as the authoritative Effect reference for this project, but as a read-only vendored dependency/docs source: do not modify files under `vendor/effect-smol` unless the user explicitly asks; avoid `effect-solutions`, `node_modules`, and random external docs unless the user explicitly asks.
- During implementation iterations, run **only scoped/filtered tests** for the feature being changed (file-level and, when useful, test-name filtering). Do **not** run the full suite repeatedly while iterating. Run the full mandatory validation suite once at handoff or when explicitly requested. Avoid live API/e2e validation runs unless the user explicitly asks for a manual pass.
- Prefer tests to live close to the source they validate when practical: use adjacent sibling `src/` + `test/` layouts for standalone workspaces/packages and Effect slices (for example `packages/kagi/{src,test}` or `src/effect/test/*`), avoid colocated `*.test.ts` files beside implementation files under `src/effect`, and reserve the top-level `tests/` folder for repo-level/cross-package coverage.
- When drafting next-session/resume prompts, do **not** restate `AGENTS.md` guidance; keep prompts short and focused on current repo state, blockers, and the concrete next refactor.
- Prefer **larger migration/refactor slices** over overly tiny micro-tasks when safety/rollback is still reasonable; split work only when risk, validation cost, or parity concerns justify it.
- For interactive/TUI or long-running process validation, prefer **tmux-managed test sessions** (fixed pane size, scripted `send-keys`, `capture-pane` snapshots, explicit session cleanup) locally and over SSH.
- Prefer **static module imports**; avoid dynamic/lazy `import()` unless technically required (and briefly justify when used).
- Do not introduce dynamic imports in new Effect code paths; use static imports and Effect-native/database-integrated approaches where possible.
- Keep provider-specific behavior, transport/session handling, and error classification inside provider package/module boundaries; `src/effect/*` runtime/entry adapters should consume typed provider errors and stay thin/provider-agnostic.
- Prefer Effect-based provider package interfaces (including `packages/kagi/*` runtime surfaces); keep `Promise`/`async` only at explicit external boundaries.
- Do not expose user-facing provider selection values like `"auto"`; omitted provider should continue to mean the default Kagi-first fallback flow.
- Treat `packages/legacy-web-access/src/*` as the legacy reference/stability baseline during migration; keep it isolated behind that package boundary and avoid pulling new logic back into the main `src/` tree.
- Treat `packages/legacy-web-access/*` as reference-only by default; avoid modifying legacy files unless the task explicitly targets parity/debugging there, and prefer extracting shared logic into Effect-owned or neutral shared modules instead.
- When validating package installation behavior, default to **global `pi install` (no `-l`)** so settings are exercised under `~/.pi` (agent settings path), unless the user explicitly asks for project-local install behavior.
- Keep fork repository metadata URLs aligned to the current git `origin` remote (owner/repo casing included), unless the user explicitly asks otherwise.
- Prefer Effect-native instrumentation (`Effect.fn`, spans, typed errors) plus lightweight local event-emission services for migration observability; avoid adding OpenTelemetry/export pipeline work unless explicitly requested.
- Prefer direct standard Effect/platform APIs over repo-specific wrapper modules in `src/effect/core/*` and `src/effect/observability/*`; if a custom abstraction is not buying a real boundary, simplify/remove it instead of preserving it.
- Keep internal migration flows Effect-native end-to-end; only convert to `Promise`/`async` at explicit external boundaries (tool `execute`, CLI main, interop wrappers), and keep that conversion as close to the boundary as possible.
- Prefer Effect-native structure over helper soup: use `Effect.fn`, `Effect.gen`, services/layers, `Schema`, `Config`, and combinator-based error handling instead of bespoke one-line wrapper functions, manual try/catch plumbing, or ad-hoc control-flow helpers when a standard Effect API already covers the case.
- Prefer handling failures in the Effect error channel with combinators (`Effect.catch`, `catchTag`, `catchTags`, `mapError`, etc.) rather than custom out-of-band error branching where practical.
- Observability/event services must be optional and fail-open: if emitting/persisting events fails, feature/tool behavior must continue.
- Prefer schema-first boundaries: define Effect `Schema` once and derive runtime validation/decoding + TypeScript types from it where serde/input contracts exist.
- Prefer Effect `Schema` for parsing/serialization work when practical; avoid ad-hoc JSON/shape parsing when a shared schema boundary would clarify the contract.
- At third-party boundaries, normalize nullable/undefined payloads with schema transforms/codecs (recursive normalization when needed) before domain logic.
- Do not use raw `as` casts for tool parameters in Effect entry paths; decode/validate boundary inputs and return actionable errors.
- Prefer Effect-native retry/timeouts (`Effect.retry`, `Schedule`, `Effect.timeout`) over bespoke retry helpers in Effect paths.
- For standalone/dual-use tooling paths, prefer the local Effect CLI modules from `vendor/effect-smol` (currently `effect/unstable/cli` in the v4 beta repo) over bespoke argument parsing or `@effect/cli`; use hand-rolled parsers only as temporary migration shims.
- Prefer Effect Config (`Config`, `Schema.Config`, `ConfigProvider`) over ad-hoc env/json config readers for new or refactored config surfaces.
- Prefer migrating new/refactored Effect code toward the local `vendor/effect-smol` v4 stack/package surfaces rather than adding more dependency on the current v3-era split packages.
- Standardize new/refactored runtime code on **Node-oriented Effect interfaces**; use Bun for local execution/compilation/test runs, but do not preserve separate Bun-vs-Node implementation paths unless the user explicitly asks. Prefer Node-side Effect packages/APIs (for example `@effect/sql-sqlite-node`) over bespoke dual-runtime shims.
- Avoid ad-hoc direct-run detection helpers (`typeof Bun`, `Bun.argv[1]`, filename sniffing). Keep modules importable and expose explicit CLI/program entrypoints via dedicated scripts or standard Effect CLI / runtime mains instead.
- Prefer shared/effect-owned helpers over importing implementation modules from `packages/legacy-web-access/src/*` into new Effect code; if both paths need the same utility, extract it to a neutral shared module or make the legacy package delegate to the shared/effect-owned implementation instead of the reverse.
- `ast-grep` is available and you should use it liberally :)
- when you see an slop code issue, and you think it can be fixed easily with ast-grep , query and fix it right away
- Prefer the locally available power tools when they reduce risk or improve review quality: `difft`/difftastic for semantic diffs, `fd` for file discovery, `jq` for JSON inspection/transforms, `delta` for readable git diffs, and `rg` for fast text search.
- Preserve user-facing behavior and tool contracts, but do not keep legacy implementation-detail compatibility, helper-shape parity, or low-value unit tests (for example CLI help-string assertions) unless they protect an actual repo boundary.
- Keep docs maintenance proportional: prioritize `AGENTS.md`, `task-tracker.md`, the current migration handoff, and user-facing README/install docs; avoid spending time preserving stale historical notes unless they directly affect current work.
## Mandatory Validation After Every Change

Run all commands below and ensure they pass before finishing work.

**Feature rule (strict):** If you add or change a feature, you must add or update at least one test that validates that feature's behavior. Then run that test (plus full test suite) before finishing.

```bash
bun run typecheck
bun run test
bun run test:e2e:cookies
bun run test:e2e:search:gemini
pi --no-extensions -e ./src/effect/index.ts --help
```

Notes:
- `test:e2e:search:gemini` writes artifacts into `test-output/`.
- If e2e fails intermittently, keep artifacts and record failures in `docs/migration-spec.md` bug ledger.
- When changing `src/effect/*` entry/CLI behavior, also validate Effect CLI loading (e.g. `pi --no-extensions -e ./src/effect/index.ts --help` or `bun run test:e2e:effect:help`).
- `test:e2e:cookies` is **macOS only** - Chrome cookie decryption uses platform-specific Keychain APIs (no Linux/Windows implementation currently).

## Testing Scope

### Repo-level automated tests (`tests/`)
- cross-package boundaries
- extension/runtime integration coverage
- legacy/effect parity checks

### Package-local automated tests
- package workspaces should prefer sibling `test/` folders (for example `packages/kagi/test`)
- Effect/runtime slices should prefer adjacent `test/` folders (for example `src/effect/test`) instead of colocated `*.test.ts` beside implementation files

### Existing smoke scripts (`scripts/`)
- Chrome cookie auth path
- Gemini search end-to-end path

## Migration Process

Follow `docs/migration-spec.md`:
1. Foundation (Effect core)
2. Local observability (SQLite event store)
3. Vertical slice migrations (search first)
4. Cutover to `src/effect/index.ts`

Keep `packages/legacy-web-access` intact until parity checks pass.

## Key Project Docs

- Migration spec: `docs/migration-spec.md`
- Migration prep: `docs/effect-migration-prep.md`
- Effect reference snapshot: `docs/references/effect-llms.txt`
- Primary local Effect v4 docs/source: `vendor/effect-smol/LLMS.md` + `vendor/effect-smol/ai-docs` + `vendor/effect-smol/packages/*`
- Session handoff context: `docs/migration-context.md`
- Running migration tracker: `task-tracker.md` (repo root)

## Task Tracking & Completion Workflow

Use `task-tracker.md` as the single source of truth for migration progress.

Task state format is symbol-only. See `task-tracker.md` legend at the top.

Rules:
1. Start work by moving one task to `[@]`.
2. When implementation + tests are complete, mark `[@User]` and add a short result note.
3. User confirms, then set `[x]`.
4. Keep tasks boundary-focused, but prefer meaningful end-to-end refactor slices over overly small micro-tasks when they remain safe and reversible.

After finishing each task, provide a brief summary in chat: **Done / Not done / Risks**.

## When Adding New Features During Migration

- Implement in `src/effect/*` (unless required hotfix in old path)
- Add/adjust tests first when possible
- **Never merge a feature without a test that covers it** (unit/contract/snapshot/e2e as appropriate)
- Run the specific new/updated test(s) and then run full `bun run test`
- Add structured errors (typed) instead of generic string errors
- Emit observable events (once EventStore is introduced)
