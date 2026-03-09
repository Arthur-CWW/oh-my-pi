# Migration Task Tracker

_Last updated: 2026-02-21_

State legend (symbol-only):
- `[ ]` Open
- `[@]` Ongoing
- `[@User]` Checking (awaiting user validation)
- `[x]` Checked
- `[~]` Obsolete
- `[?]` In Question

## Tasks

- [x] Create migration baseline (old/new folder split, docs, handoff context).
- [x] Add initial boundary tests and e2e smoke scripts.
- [x] Enforce no-`any` rule in agent instructions and testing expectations.
- [x] Add running task workflow to AGENTS.md and create this tracker.
  - Result: tracker + state model added.

- [x] Add Effect TS dependencies and scaffold core modules (`Config`, `Errors`, `Http`, `Observability`) with tests.
  - Result: Added `effect`, `@effect/schema`, `@effect/platform`, `@effect/platform-node`; created `src/effect/core/{Config,Errors,Http,Observability,index}.ts`; added `tests/effect-core.test.ts`; all mandatory validation commands passed.
- [x] Implement local SQLite event store for structured event sourcing in `src/effect`.
  - Result: Added `src/effect/observability/EventStore.ts` (+ index) with SQLite-backed append/list APIs, bun/node sqlite driver fallback, schema + indexes, and typed `EventStoreError` handling; added `tests/event-store.test.ts`; mandatory validation commands passed.
- [x] Migrate `gemini-search` to Effect vertical slice with parity tests against `src/old` behavior.
  - Result: Added flattened `src/effect/gemini-search.ts` (single-file Effect slice, no nested folder/index re-export) with provider-selection parity and typed `SearchUnavailableError`; added `tests/gemini-search-effect.test.ts` covering legacy parity for gemini-unavailable path and boundary helpers (`buildSearchPrompt`, `extractSourceUrls`) plus fallback behavior; mandatory validations passed.
- [x] Add snapshot tests for stable boundary outputs (search normalization / condensed summaries).
  - Result: Added `tests/search-snapshots.test.ts` with golden snapshot assertions for `preprocessSearchResults` normalization output and `postProcessCondensed` summary output; added snapshot fixtures under `tests/snapshots/{search-preprocess.snapshot.json,search-condensed.snapshot.md}`; validations passed.
- [x] Wire `src/effect/index.ts` shadow entry for non-production dry runs.
  - Result: Extended `src/effect/index.ts` shadow extension to register `web_search` (Effect Gemini slice), `chrome_cookies` (Effect cookie reader), and `effect_event_store_smoke`; updated `tests/effect-index.test.ts`; added Effect e2e scripts `scripts/e2e-search-gemini-effect.ts` + `scripts/e2e-chrome-cookies-effect.ts` and package scripts `test:e2e:search:gemini:effect` + `test:e2e:cookies:effect`; CLI loading and effect e2e flows pass.
- [x] Cut over extension entrypoint from `src/old/index.ts` to `src/effect/index.ts` after parity.
  - Result: Switched `package.json` extension entry to `./src/effect/index.ts`; updated Effect entrypoint to load legacy tool surface via compatibility bridge and register Effect-only tools (`chrome_cookies`, `effect_event_store_smoke`) without overriding legacy `web_search`; added cutover tests in `tests/effect-index.test.ts` (tool-surface parity + package entry assertion); full validation pass completed (typecheck, tests, legacy/effect e2e, old/effect CLI help).
- [x] Add direct CLI mode for search/cookies/fetch modules (`bun <file>.ts ...`) while keeping extension behavior.
  - Result: Added direct-run CLI helpers in `src/effect/gemini-search.ts`, `src/effect/chrome-cookies.ts`, and `src/old/extract.ts` with argument parsing + `--help/--json`; added unit coverage for parsers/runners in `tests/gemini-search-effect.test.ts`, `tests/effect-cookies.test.ts`, and `tests/extract-cli.test.ts`; documented usage in README Direct CLI section.
- [x] Continue Kagi unofficial client: add dynamic lens discovery, broaden advanced-search coverage/tests, and package-local standalone metadata (`packages/kagi/package.json`).
  - Result: Added dynamic lens discovery (`discoverLenses` + HTML/JSON extraction + discovery-enabled search path), expanded `tests/kagi-client.test.ts` for advanced-search payload/default behavior and lens extraction/usage, introduced `lenses:list` CLI command + `--discover-lenses` search flag, added `packages/kagi/package.json`, and updated Kagi docs (`packages/kagi/{README.md,HANDOFF.md,notes/api-quirks.md}`); validations passed.
- [@User] Promote Kagi as default `web_search` provider in Effect entry, and continue Puppeteer reverse-engineering captures.
  - Result: Moved Google-style query parsing into package-level module `packages/kagi/src/kagi-query-parser.ts` with structured output (`baseQuery`, `normalizedQuery`, site/date/filetype/title/url/text filters, phrases, excluded terms) plus quirk metadata (`unsupportedOperators`, `unmappedDateOperators`); aligned parser notes with Kagi operator docs (`help.kagi.com/.../search-operators.html`) and preserved coarse date operators inline (e.g. `after:2025` not coerced to `from_date`); wired `src/effect/kagi-search.ts` to emit query diagnostics and extract `publishedAt` result metadata; updated `src/effect/index.ts` tool description/help and source rendering to include snippets + date fields; added interactive visualizer module `packages/kagi/src/kagi-visualizer.ts` and CLI command `bun packages/kagi/scripts/kagi-lab.ts visualize ...` (iframe-rendered SSE HTML, parsed JSON/results pane, vim-style navigation keys); expanded tests in `tests/{kagi-query-parser,kagi-search-effect,effect-index,kagi-visualizer}.test.ts`; validated Kagi API e2e directly via `kagi-lab search` and extension CLI using `site:gwern.net filetype:pdf` queries.
- [@User] Publish npm package refresh and validate global `pi install` flow via `~/.pi` settings.
  - Result: Scoped fork publish is live as `@wirebabel/pi-web-access@0.10.3`; verified `npm view @wirebabel/pi-web-access version` resolves and `pi install npm:@wirebabel/pi-web-access` succeeds (project-local install check in temp workspace). Initial 404s were short registry propagation lag immediately after publish.
- [@User] Rebrand fork metadata and docs links to `wirebabel` ownership.
  - Result: Updated fork attribution (`author`, LICENSE, docs link owner) while keeping package GitHub metadata URLs aligned to git `origin` (`Arthur-CWW/pi-web-access`) per user direction.
- [@User] Realign Effect migration with effect-solutions quick-start patterns for service wiring and typed errors.
  - Result: Reworked Effect migration surfaces to follow effect-solutions patterns: swapped `Data.TaggedError` to `Schema.TaggedError` across `src/effect/*`, refactored `src/effect/index.ts` into `Context.Tag` + `Layer`-driven tool services with `Effect.fn` boundaries and typed tool execution errors, and added dependency-error mapping coverage in `tests/effect-index.test.ts`; `bun run typecheck` + `bun run test` + scoped Effect tests + `pi --no-extensions -e ./src/effect/index.ts --help` pass (environment-dependent e2e scripts still require local Gemini cookies/macOS keychain).
- [@User] Fix Kagi default session resolution so `web_search` works outside this repo root.
  - Result: Added cross-directory session-path resolution in `packages/kagi/src/kagi-client.ts` (`KAGI_SESSION_PATH` override, legacy cwd/module path detection, `~/.pi/pi-web-access/kagi-session.json` fallback) plus auto-refresh on missing session; improved Effect rewrite search error handling with typed provider/fallback errors and Effect-native retry combinators; removed Perplexity from Effect `web_search` provider surface (`src/effect/{index,gemini-search,core/Config}.ts`); added/updated tests in `tests/{kagi-client,effect-index,gemini-search-effect,search-snapshots}.test.ts`; set up Effect language service (`@effect/language-service`, tsconfig plugin, prepare patch script, `.vscode/settings.json`) and added Effect best-practice block + new persistent preferences to `AGENTS.md`.
