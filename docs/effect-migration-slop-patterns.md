# Effect migration slop patterns

This doc uses `src/effect/video-extract.ts` as the baseline smell-catalog for the remaining Promise-first / legacy-style code under `src/effect/*`.

Goal: make the cleanup parallelizable without re-arguing the target Effect shape for every file.

## Ground truth to follow

Use these local Effect references first:

- `vendor/effect-smol/LLMS.md`
- `vendor/effect-smol/ai-docs/src/01_effect/01_basics/02_effect-fn.ts`
- `vendor/effect-smol/ai-docs/src/01_effect/01_basics/10_creating-effects.ts`
- `vendor/effect-smol/ai-docs/src/01_effect/02_services/01_service.ts`
- `vendor/effect-smol/ai-docs/src/01_effect/02_services/10_reference.ts`
- `vendor/effect-smol/ai-docs/src/01_effect/02_services/20_layer-unwrap.ts`
- `vendor/effect-smol/ai-docs/src/01_effect/03_errors/10_catch-tags.ts`
- `vendor/effect-smol/ai-docs/src/06_schedule/10_schedules.ts`
- `vendor/effect-smol/ai-docs/src/50_http-client/10_basics.ts`
- `vendor/effect-smol/ai-docs/src/60_child-process/10_working-with-child-processes.ts`

Relevant local source implementations/examples:

- `vendor/effect-smol/packages/effect/src/unstable/http/HttpIncomingMessage.ts`
- `vendor/effect-smol/packages/effect/src/unstable/process/ChildProcessSpawner.ts`
- `vendor/effect-smol/packages/effect/src/ServiceMap.ts`
- `src/effect/search-runtime.ts`
- `src/effect/gemini-web.ts`
- `src/effect/observability/EventStore.ts`
- `packages/kagi/src/kagi-search-effect.ts`

## What “done” looks like for an Effect runtime module

A migrated runtime/helper file is in good shape when most of the following are true:

1. Core logic is exported as `Effect.fn("...")`, not as Promise-first `async` helpers.
2. `Effect.runPromise*` only appears at explicit external boundaries.
   - good: CLI main, tool `execute`, compatibility wrapper
   - bad: one internal Effect module calling another module’s Promise wrapper
3. External APIs are wrapped with `Effect.try` / `Effect.tryPromise`.
4. Failure travels in the Effect error channel via typed/tagged errors.
5. HTTP boundaries use `HttpClient` + schema decoding where practical.
6. Child-process work uses `ChildProcessSpawner` rather than `execFileSync`.
7. Polling/retry/timeouts use `Schedule`, `Effect.retry`, `Effect.sleep`, `Effect.timeout`.
8. Config is read through `Config`, `ServiceMap.Reference`, or layer construction, not ad-hoc sync JSON reads inside domain helpers.
9. JSON / third-party responses are decoded with `Schema` rather than raw `as` casts.
10. Dependencies are injectable via service/layer or explicit deps objects.
11. Silent `catch { return null }` is reserved for deliberate fail-open adapter edges only, not core workflow control flow.

## `src/effect/video-extract.ts` slop ledger

This file is a good migration template because it contains many recurring anti-patterns in one place.

| ID | Pattern | Evidence in `src/effect/video-extract.ts` | Target shape |
| --- | --- | --- | --- |
| P1 | Promise-first core exports | `extractVideo` (line 113), `extractVideoFrame` (144), `getLocalVideoDuration` (172), `extractLocalFrames` (189) are exported as `async` functions even though they are internal runtime logic | Export `extractVideoEffect`, `extractVideoFrameEffect`, etc. with `Effect.fn`; keep Promise wrappers only if an external boundary still needs them |
| P2 | Sync Node fs / process in core logic | `execFileSync` import (1), `statSync` (75), `existsSync` (90, 96), `readdirSync` (102), `execFileSync` calls (146, 174) | Use `ChildProcessSpawner` for `ffmpeg` / `ffprobe`; move fs/path access behind Effect services or at least `Effect.try` shims as a temporary step |
| P3 | Promise wrapper composition inside Effect-owned code | `await isGeminiWebAvailable()` (217) and `await queryWithCookies(...)` (221) call Promise wrappers from `src/effect/gemini-web.ts` instead of composing the Effect exports | Import and compose `isGeminiWebAvailableEffect` / `queryWithCookiesEffect` directly |
| P4 | `null` / sentinel unions used as the main failure path | repeated `return null`; unions like `number | { readonly error: string }`; `FrameResult` uses out-of-band `{ error }` | Keep typed errors in the error channel internally, then map to legacy/null contracts only at the outermost adapter |
| P5 | Silent error swallowing | bare `catch { return null; }` in `resolveFilePath` (104-105), `tryVideoGeminiWeb` (233-234), `tryVideoGeminiApi` (266-267), delete cleanup swallow (351) | Use tagged errors + `Effect.catchTag(s)` / `Effect.result`; if fail-open is intended, log/annotate it explicitly |
| P6 | Manual polling / timers | `while (Date.now() < deadline)` loop (330) + `new Promise(setTimeout)` (345) in `pollFileState` | Use `Effect.retry` / `Schedule` and `Effect.sleep`; enforce timeout with `Effect.timeout` |
| P7 | Raw `fetch` orchestration in core module | upload/init/poll/delete `fetch` calls at 281, 304, 334, 351 | Prefer `HttpClient`; at minimum wrap with `Effect.tryPromise` and centralize status/JSON decode |
| P8 | Raw response cast | `(await uploadResponse.json()) as { readonly file: { readonly name: string; readonly uri: string } }` (319) | Define a `Schema.Struct` for the response and decode it |
| P9 | Config lookup from inside domain helpers | `readVideoConfig()` in `isVideoFile` and `extractVideo` | Provide config once via `Config` / `ServiceMap.Reference` / deps object |
| P10 | Promise concurrency instead of Effect concurrency | `Promise.all(...)` in `extractLocalFrames` (193) | Use `Effect.forEach` with explicit concurrency / error behavior |
| P11 | Hard-coded concrete dependencies | direct imports of `getApiKey`, `queryGeminiApiWithVideo`, `isGeminiWebAvailable`, `queryWithCookies`, global `fetch`, `ffmpeg`, `ffprobe` | Introduce a service/deps boundary for video extraction operations |
| P12 | Fire-and-forget cleanup with no observability | `deleteGeminiFile` just does `fetch(...).catch(() => {})` (351) | Model cleanup as an Effect and decide explicitly whether it is required or fail-open |

## Why these are specifically “not the Effect shape”

These are the replacement patterns we should standardize on:

- `Effect.fn` for effectful functions returning domain values
  - see `vendor/effect-smol/ai-docs/src/01_effect/01_basics/02_effect-fn.ts`
- `ServiceMap.Service` / `ServiceMap.Reference` for behavior + config
  - see `vendor/effect-smol/ai-docs/src/01_effect/02_services/01_service.ts`
  - see `vendor/effect-smol/ai-docs/src/01_effect/02_services/10_reference.ts`
- `Effect.catchTag` / `Effect.catchTags` for typed recovery
  - see `vendor/effect-smol/ai-docs/src/01_effect/03_errors/10_catch-tags.ts`
- `Schedule` + `Effect.retry` for polling/backoff
  - see `vendor/effect-smol/ai-docs/src/06_schedule/10_schedules.ts`
- `HttpClient` + schema decode for HTTP
  - see `vendor/effect-smol/ai-docs/src/50_http-client/10_basics.ts`
- `ChildProcessSpawner` for commands
  - see `vendor/effect-smol/ai-docs/src/60_child-process/10_working-with-child-processes.ts`
- `Config` / `Layer.unwrap` for config-driven construction
  - see `vendor/effect-smol/ai-docs/src/01_effect/02_services/20_layer-unwrap.ts`

## Suggested target shape for the video extraction slice

Not a required file split, just the target architecture:

- `VideoExtractConfig`
  - config service / reference for `enabled`, `preferredModel`, `maxSizeMB`
- `VideoTools`
  - Effect service for `ffmpeg` / `ffprobe`
- `GeminiVideoClient`
  - Effect service for upload / poll / delete / extract calls
- `VideoExtractError`
  - tagged error family for file resolution, process failures, upload failures, polling failures, schema failures
- Effect-first exports
  - `resolveVideoFileEffect`
  - `extractVideoFrameEffect`
  - `getLocalVideoDurationEffect`
  - `extractLocalFramesEffect`
  - `tryVideoGeminiApiEffect`
  - `tryVideoGeminiWebEffect`
  - `extractVideoEffect`
- optional temporary wrappers
  - `export async function extractVideo(...) { return Effect.runPromise(extractVideoEffect(...)) }`
  - only if some non-Effect caller still requires Promise shape during migration

## Current hotspot snapshot (`src/effect/*`)

Quick smell-count snapshot taken on 2026-03-12. This is only a prioritization aid, not a substitute for reading the file.

| File | Async fns | Raw fetch | Sync fs/process | `return null` | silent `catch {}` | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `src/effect/video-extract.ts` | 8 | 4 | 11 | 13 | 3 | Best canonical media-cleanup target |
| `src/effect/github-extract.ts` | 3 | 0 | 15 | 10 | 10 | Biggest sync-fs/silent-catch hotspot |
| `src/effect/youtube-extract.ts` | 8 | 1 | 3 | 8 | 4 | Very similar to video path |
| `src/effect/fetch-content-runtime.ts` | 0 | 3 | 0 | 15 | 1 | Review carefully; some `null` returns are deliberate adapter-level fallback |
| `src/effect/github-api.ts` | 7 | 0 | 0 | 8 | 2 | Boundary layer still Promise-heavy |
| `src/effect/gemini-web.ts` | 2 | 3 | 2 | 1 | 2 | Transitional Effect-first file |
| `src/effect/gemini-api.ts` | 1 | 1 | 4 | 1 | 1 | Good config/http/schema cleanup target |
| `src/effect/rsc-extract.ts` | 0 | 0 | 0 | 5 | 2 | Smaller null/silent-catch cleanup |
| `src/effect/fetch-content-config.ts` | 0 | 0 | 4 | 0 | 1 | Small but high leverage |
| `src/effect/pdf-extract.ts` | 1 | 0 | 0 | 0 | 2 | Smaller boundary cleanup |

A few files show boundary-only smells that are lower priority:

- `src/effect/index.ts` has many `Effect.runPromise*` uses because it is an external tool/CLI boundary.
- `src/effect/search-runtime.ts` and `src/effect/chrome-cookies.ts` have a small number of async wrappers that are likely boundary-compatible shims, not the main migration problem.
- `src/effect/chrome-cookies-legacy.ts` is still noisy, but it is explicitly legacy-ish and should stay lower priority unless the task targets it.

## Repo-wide hotspot queries

Use these commands to find similar slop quickly.

### Promise-first core functions

```bash
rg -n "export async function|async function [A-Za-z0-9_]+\\(" src/effect -g '*.ts'
```

High-signal hits:

- `src/effect/video-extract.ts`
- `src/effect/youtube-extract.ts`
- `src/effect/github-api.ts`
- `src/effect/github-extract.ts`
- `src/effect/gemini-api.ts`
- `src/effect/pdf-extract.ts`

### Sync fs / sync process usage

```bash
rg -n "execFileSync|readFileSync|existsSync|statSync|readdirSync|spawnSync|mkdirSync|writeFileSync" src/effect -g '*.ts'
```

High-signal hits:

- `src/effect/video-extract.ts`
- `src/effect/youtube-extract.ts`
- `src/effect/github-extract.ts`
- `src/effect/gemini-api.ts`
- `src/effect/gemini-web.ts`
- `src/effect/fetch-content-config.ts`
- `src/effect/core/Config.ts`
- `src/effect/observability/EventStore.ts`

### Raw `fetch` in Effect-owned modules

```bash
ast-grep --pattern 'fetch($$$ARGS)' src/effect --lang ts
```

High-signal hits:

- `src/effect/video-extract.ts`
- `src/effect/youtube-extract.ts`
- `src/effect/gemini-api.ts`
- `src/effect/gemini-web.ts`

### `null` / silent-catch / manual Promise hotspots

```bash
rg -n "Promise\\.all|new Promise\\(|return null;|catch \\{\\s*$" src/effect/*.ts src/effect/**/*.ts
```

High-signal hits:

- `src/effect/video-extract.ts`
- `src/effect/youtube-extract.ts`
- `src/effect/github-api.ts`
- `src/effect/github-extract.ts`
- `src/effect/pdf-extract.ts`
- `src/effect/rsc-extract.ts`
- `src/effect/gemini-api.ts`
- `src/effect/fetch-content-runtime.ts` (some of these are legitimate adapter-level fallbacks; review before changing)

## Parallel workboard

Use the pattern IDs above when splitting work.

| Status | File | Main pattern IDs | Notes |
| --- | --- | --- | --- |
| [ ] | `src/effect/video-extract.ts` | P1-P12 | Best canonical cleanup example |
| [ ] | `src/effect/youtube-extract.ts` | P1, P2, P3, P4, P5, P7, P10, P11 | Very similar to video path; can share abstractions |
| [ ] | `src/effect/gemini-api.ts` | P1, P4, P7, P8, P9 | Good HTTP/schema/config cleanup target |
| [ ] | `src/effect/gemini-web.ts` | P7, P8, P9, P11 | Already partly Effect-first; biggest wins are HTTP/config/service boundaries |
| [ ] | `src/effect/github-api.ts` | P1, P4, P5, P7, P8 | Mostly boundary cleanup + schemas |
| [ ] | `src/effect/github-extract.ts` | P1, P2, P4, P5, P11 | Large file; probably needs one owner |
| [ ] | `src/effect/fetch-content-config.ts` | P2, P9 | Small but high-leverage config cleanup |
| [ ] | `src/effect/core/Config.ts` | P2, P9 | Align with Effect Config patterns |
| [ ] | `src/effect/pdf-extract.ts` | P1, P4, P5 | Smaller cleanup slice |
| [ ] | `src/effect/rsc-extract.ts` | P4, P5 | Smaller cleanup slice |

## Low-conflict parallel batches

If multiple people/agents are working at once, these batches minimize merge collisions.

### Batch A — video/media process cleanup

- `src/effect/video-extract.ts`
- `src/effect/youtube-extract.ts`

Focus:

- `ChildProcessSpawner`
- Effect-first frame extraction
- shared video/media error types
- remove Promise-wrapper-to-Promise-wrapper composition

### Batch B — Gemini transport/config cleanup

- `src/effect/gemini-api.ts`
- `src/effect/gemini-web.ts`

Focus:

- `HttpClient`
- schema decoding
- config via `Config`
- fail-open behavior only at explicit adapter edges

### Batch C — GitHub extraction cleanup

- `src/effect/github-api.ts`
- `src/effect/github-extract.ts`

Focus:

- service boundaries for clone/API access
- remove sync fs/process
- replace null/silent-catch control flow with typed errors

### Batch D — config cleanup

- `src/effect/fetch-content-config.ts`
- `src/effect/core/Config.ts`

Focus:

- eliminate ad-hoc sync config caching in Effect paths
- standardize on `Config`, `ConfigProvider`, `ServiceMap.Reference`, or `Layer.unwrap`

### Batch E — smaller null/error cleanup

- `src/effect/pdf-extract.ts`
- `src/effect/rsc-extract.ts`

Focus:

- remove `null` as the internal error channel
- add schemas / typed errors where useful

## What is *not* slop

Do not “fix” these without a concrete reason:

- `Effect.runPromise`, `Effect.runPromiseExit`, `NodeRuntime.runMain`, or CLI `run` calls at explicit external boundaries
- thin compatibility wrappers kept temporarily so non-Effect callers can still consume an Effect-first module
- adapter-level `null` results that truly mean “not applicable / unavailable”, rather than “operation failed”
- fail-open observability paths where continuing behavior is the intended contract

The smell is not the syntax by itself. The smell is when boundary-oriented syntax leaks into internal domain/runtime logic.

## Gemini Web auth / cookies refactor notes

The current pattern in `src/effect/fetch-content-runtime.ts` and `src/effect/gemini-search.ts` is a smell:

```ts
const cookies = yield* runtimeDeps.isGeminiWebAvailable().pipe(
  Effect.catch(() => Effect.succeed(null)),
  Effect.catchDefect(() => Effect.succeed(null))
)
if (!cookies) {
  return null
}
```

### Why this is slop

- auth/session state leaks into callers
- callers know about `CookieMap`, which should be an internal transport detail
- the fallback policy is duplicated at each call site
- `unknown` error channels force overly broad `Effect.catch(...)`
- `Effect.catchDefect(...)` hides bugs that should usually remain defects
- `null` conflates “Gemini Web unavailable” with “Gemini Web request failed”

### Preferred shape

Treat this as a **service boundary** first, not a repeated inline check.

Use a **resource** only if we later keep alive a long-lived browser / DevTools / websocket session.

Good next abstraction:

- `GeminiWebClient` service
  - `query(...)` — strict API
  - `queryIfAvailable(...)` — unavailable becomes no result, but operational errors still fail
  - `queryFailOpen(...)` — explicit fail-open wrapper for outer fallback edges only

### Public semantics to standardize

Avoid `queryOptional` as the primary internal API name because it is ambiguous.

Prefer these names / semantics instead:

#### `query(prompt, options)`

- returns `Effect.Effect<string, GeminiWebUnavailable | GeminiWebRequestError | GeminiWebDecodeError | ...>`
- missing cookies / not signed in => fail with `GeminiWebUnavailable`
- request / parse / upload failures => fail with typed errors
- defects stay defects

#### `queryIfAvailable(prompt, options)`

- returns `Effect.Effect<Option<string>, GeminiWebRequestError | GeminiWebDecodeError | ...>` conceptually
- unavailable => no result
- operational failures still fail
- best default for internal fallback orchestration

#### `queryFailOpen(prompt, options)`

- returns `Effect.Effect<Option<string>>` conceptually
- unavailable => no result
- tagged/expected operational failures may also become no result
- defects should still remain defects unless there is a very explicit reason to swallow them

If we keep a compatibility wrapper called `queryOptional`, document it as a thin adapter and specify exactly one meaning. Do **not** leave it ambiguous between:

- unavailable-only soft fallback
- all-expected-failure soft fallback
- `string | null` compatibility wrapper

### `fetch-content-runtime.ts` and raw `fetch`

`src/effect/fetch-content-runtime.ts` is still using a transitional transport abstraction:

- `readonly fetch: (...) => Promise<Response>` in deps
- manual `Response` parsing helpers
- ad-hoc status/headers/body handling in the orchestration module

That is migration debt, not the target architecture.

Preferred direction:

- move page/Jina/Gemini URL-context HTTP logic behind Effect `HttpClient`
- keep `fetch-content-runtime.ts` focused on orchestration and fallback policy
- stop exposing transport details (`fetch`, `Response`, `CookieMap`) to orchestration callers

## Migration rules for parallel contributors

1. Do not change user-facing tool contracts unless the task explicitly includes contract cleanup.
2. Prefer converting the core to Effect-first first, then leave a thin Promise wrapper if callers still need it.
3. Do not introduce new `any` or raw `as` casts.
4. If a module already has an Effect export, compose that export directly; do not call its Promise wrapper from another internal runtime module.
5. If you add a service/deps abstraction, keep it flat and local to the slice unless multiple files already share it.
6. For files with lots of `return null`, first separate:
   - legitimate “not applicable / unavailable” results
   - actual operational failures
7. For polling/retry logic, prefer `Schedule` over hand-written loops.
8. For HTTP JSON, define the schema once and decode at the boundary.
9. For subprocesses, prefer `ChildProcessSpawner`; if you need a temporary step, at least isolate the process call into one Effect-wrapped boundary.
10. Keep observability fail-open, but never silently swallow failures without at least one obvious decision point.

## Completion checklist for a file

- [ ] Core exports are `Effect.fn`-based
- [ ] Promise wrappers only remain at explicit boundaries
- [ ] No raw `fetch`/`execFileSync`/sync fs scattered through domain logic
- [ ] Config is injected or Effect-managed
- [ ] External JSON is schema-decoded
- [ ] Error channel uses typed/tagged errors
- [ ] `null` is no longer the main operational failure mechanism
- [ ] Retry/poll/timeouts use Effect primitives
- [ ] Tests cover at least one migrated behavior boundary

## Notes

- `src/effect/fetch-content-runtime.ts` already shows a better overall orchestration style (`Effect.fn`, explicit deps, typed error channel in many places), but it still contains some adapter-level `null` fallbacks. Treat that file carefully; do not blindly replace all `null` returns there.
- `src/effect/gemini-web.ts` is a useful transitional example: it already has Effect-first core exports plus thin Promise wrappers. That is a good intermediate state for `video-extract.ts` and `youtube-extract.ts`.
- This doc is intentionally about recurring patterns, not about forcing a large folder explosion. Keep the file layout flat unless a shared abstraction clearly pays for itself.
