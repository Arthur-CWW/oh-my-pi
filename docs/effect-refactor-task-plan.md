# Effect refactor task plan

_Last updated: 2026-03-12_

This doc turns the current Effect migration smells into concrete refactor tasks, with notes on sequencing, ownership, and whether a task is large/isolated enough to delegate to a parallel coding agent.

Related docs:

- `docs/effect-migration-slop-patterns.md`
- `docs/effect-code-smells.md`
- `task-tracker.md`

## Key design decision to freeze first

Before parallelizing a lot of work, freeze the Gemini Web semantics.

### Proposed semantic split

#### Strict API

- `query(prompt, options)`
- fails on unavailability and operational failures
- defects remain defects

#### Soft-availability API

- `queryIfAvailable(prompt, options)`
- returns no result when Gemini Web is unavailable
- still fails on operational failures
- best default for internal fallback orchestration

#### Explicit fail-open API

- `queryFailOpen(prompt, options)`
- returns no result for expected/unavailable failures at outer fallback edges
- should not become the default everywhere

### Naming note

Avoid using `queryOptional` as the main internal API because it is ambiguous.

If a compatibility wrapper named `queryOptional` exists, document exactly which one of these it means:

1. unavailable-only soft fallback
2. all-expected-failure soft fallback
3. `string | null` compatibility adapter

## Dependency / sequencing overview

```text
T1 Freeze GeminiWebClient semantics + typed errors
  -> T2 Implement GeminiWebClient service in gemini-web.ts
    -> T3 Switch gemini-search.ts to GeminiWebClient
    -> T4 Switch fetch-content-runtime.ts to GeminiWebClient
      -> T5 Remove cookie-plumbing from video/youtube callers

T6 Introduce HttpClient-based services for page/Jina/Gemini URL-context transport
  -> T7 Switch fetch-content-runtime.ts transport paths to those services

T8 Refactor video/youtube process paths to Effect-native subprocess boundaries
T9 Refactor github-api.ts/github-extract.ts
T10 Cleanup config surfaces
T11 Cleanup schema gaps / raw JSON casts
```

## Task list

| ID | Task | Main files | Size | Parallel-agent fit? | Notes |
| --- | --- | --- | --- | --- | --- |
| T1 | Freeze Gemini Web semantics + names | docs + `src/effect/gemini-web.ts` contract | S | No | One owner should settle semantics first |
| T2 | Add `GeminiWebClient` service + typed errors | `src/effect/gemini-web.ts`, maybe `src/effect/chrome-cookies.ts` | M | No (until T1 frozen) | Cross-cutting API change |
| T3 | Switch search flow to `GeminiWebClient` | `src/effect/gemini-search.ts` | M | Yes, after T2 | Good isolated follow-up once API is stable |
| T4 | Switch fetch-content runtime to `GeminiWebClient` | `src/effect/fetch-content-runtime.ts`, tests | L | Cautious yes, after T2 | Central file, but doable if one agent owns it |
| T5 | Remove cookie/plumbing from media callers | `src/effect/video-extract.ts`, `src/effect/youtube-extract.ts` | M | Yes, after T2 | Can share abstractions with media cleanup |
| T6 | Design/introduce `HttpClient` transport services | new/updated Effect service files | M/L | No | Freeze transport interfaces first |
| T7 | Replace raw `fetch` in fetch-content runtime with `HttpClient`-backed services | `src/effect/fetch-content-runtime.ts` + helper services | XL | Yes, but one owner | Big slice; good delegation candidate if isolated |
| T8 | Refactor video/youtube subprocess paths to Effect-native process boundaries | `src/effect/video-extract.ts`, `src/effect/youtube-extract.ts` | L | Yes | Good batch for one parallel agent |
| T9 | Refactor GitHub extraction stack | `src/effect/github-api.ts`, `src/effect/github-extract.ts` | XL | Yes | Excellent delegated task; large and isolated |
| T10 | Clean config surfaces | `src/effect/fetch-content-config.ts`, `src/effect/core/Config.ts`, maybe `src/effect/gemini-api.ts` | M | Yes | Low-conflict batch |
| T11 | Replace raw JSON casts with schema boundaries | `src/effect/gemini-search.ts`, `src/effect/video-extract.ts`, `src/effect/fetch-content-runtime.ts`, `src/effect/gemini-api.ts` | M | Yes, after interface freezes | Avoid parallel edits to the same file |
| T12 | Tighten `unknown` error channels in internal deps | `src/effect/*` orchestrators + entry adapters | M | Cautious | Good cleanup after service boundaries settle |

## Recommended execution order

## Phase A — freeze the shared abstraction

### T1 — Freeze Gemini Web semantics + names

Output:

- clear API names
- clear unavailable vs failure semantics
- decision on whether `queryOptional` exists only as compatibility wrapper

Why first:

- many other tasks depend on this contract
- parallel work before this will create churn

### T2 — Implement `GeminiWebClient` service

Output:

- service hides cookie/session details
- callers no longer see `CookieMap`
- typed error taxonomy

Why second:

- unlocks safe parallel follow-ups in search/runtime/media files

## Phase B — remove cookie leakage from callers

### T3 — Switch `src/effect/gemini-search.ts`

Scope:

- remove direct cookie plumbing deps
- consume `GeminiWebClient`
- replace broad fail-open wrappers with targeted semantics

Parallel-agent recommendation:

- **yes**, once T2 lands and the API is stable
- good medium-sized isolated task

### T4 — Switch `src/effect/fetch-content-runtime.ts`

Scope:

- remove `CookieMap` and `isGeminiWebAvailable` from deps
- consume `GeminiWebClient`
- centralize fallback semantics

Parallel-agent recommendation:

- **yes, but give it one owner**
- this file is large and central, so do not split it among multiple agents at once

### T5 — Switch `video-extract.ts` + `youtube-extract.ts`

Scope:

- stop calling Promise wrappers from `gemini-web.ts`
- remove cookie/session plumbing
- consume service or direct Effect-first API

Parallel-agent recommendation:

- **yes** as a single media batch
- good match for one delegated agent

## Phase C — transport cleanup

### T6 — Introduce `HttpClient` transport services

Scope:

- decide service boundaries for page fetch / Jina / Gemini URL-context / maybe Gemini API
- avoid exposing raw `fetch` and `Response` to orchestration files

Parallel-agent recommendation:

- **no initially**
- this is an interface design task; one owner should freeze it first

### T7 — Move `fetch-content-runtime.ts` off raw `fetch`

Scope:

- consume the new services
- delete raw `fetch` deps from the runtime module
- reduce manual `Response` parsing in orchestration code

Parallel-agent recommendation:

- **yes** after T6 is frozen
- this is large enough to justify a dedicated parallel agent

## Phase D — big isolated slices

### T8 — Media/process cleanup

Scope:

- `ChildProcessSpawner` for video/youtube subprocess work
- reduce sync fs/process usage
- move toward Effect-first exports

Parallel-agent recommendation:

- **yes**
- best delegated as one owner for both media files because they will likely share abstractions

### T9 — GitHub extraction cleanup

Scope:

- `src/effect/github-api.ts`
- `src/effect/github-extract.ts`
- reduce sync fs/process + null/silent-catch control flow
- clarify service boundaries for API/clone access

Parallel-agent recommendation:

- **yes, strongly**
- one of the best candidates for a parallel agent because it is large and relatively isolated

## Phase E — cleanup/normalization slices

### T10 — Config cleanup

Scope:

- move ad-hoc config reads toward `Config` / `ConfigProvider` / references / layers
- reduce sync file reads in Effect paths

Parallel-agent recommendation:

- **yes**
- low-conflict, medium-value cleanup batch

### T11 — Schema boundary cleanup

Scope:

- replace raw JSON casts with `Schema` decoders
- keep decode errors actionable

Parallel-agent recommendation:

- **yes, but not on the same files another agent is editing**

### T12 — Tighten `unknown` error channels

Scope:

- replace `unknown` with provider/runtime-specific typed errors
- simplify recovery logic in orchestrators

Parallel-agent recommendation:

- **cautious**
- better after service and transport boundaries are already cleaned up

## Which tasks are best for a parallel agent right now?

Best current candidates:

1. **T9 — GitHub extraction cleanup**
   - big enough to matter
   - relatively isolated
   - good single-owner delegated slice

2. **T8 — Media/process cleanup**
   - `video-extract.ts` + `youtube-extract.ts`
   - enough shared logic to justify one agent owning both

3. **T10 — Config cleanup**
   - smaller, but low-conflict and good “background cleanup” batch

Conditional candidates (only after interfaces are frozen):

4. **T3 — switch `gemini-search.ts` to `GeminiWebClient`**
5. **T4 — switch `fetch-content-runtime.ts` to `GeminiWebClient`**
6. **T7 — HttpClient conversion for fetch-content runtime**

Not good parallel-agent candidates yet:

- **T1** semantics/naming freeze
- **T2** initial Gemini service introduction
- **T6** initial transport-service design

Those are contract-shaping tasks and should be done once, centrally.

## Suggested parallel batches

## Batch P1 — GitHub stack

- T9
- Owner: one agent
- Good mode: dispatch/background if the task is well-scoped

## Batch P2 — media stack

- T5 + T8
- Owner: one agent
- Good mode: dispatch if the goal is “make media extraction Effect-native end-to-end”

## Batch P3 — config/schema cleanup

- T10 + parts of T11
- Owner: one agent
- Good mode: dispatch/hands-free

## Batch P4 — runtime/search caller cleanup

- T3 + T4
- Only after T2 is merged or the service contract is otherwise frozen

## Review checklist for delegated tasks

Before accepting a delegated refactor:

- [ ] No new `any`
- [ ] No new raw `as` casts at external boundaries
- [ ] No new cookie/session leakage to callers
- [ ] No new broad `catchDefect(...)->null` policy in internal code
- [ ] If `null` remains, it clearly means “not applicable / unavailable”, not “operation failed”
- [ ] Tests updated for the behavior boundary that changed
- [ ] Promise wrappers remain only at explicit boundaries

## Minimal near-term plan

If we want the safest next steps:

1. Freeze semantics (`query` / `queryIfAvailable` / `queryFailOpen`)
2. Implement `GeminiWebClient`
3. Switch `gemini-search.ts`
4. Switch `fetch-content-runtime.ts`
5. Then delegate either GitHub cleanup or media cleanup in parallel
