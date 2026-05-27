# Effect code smells inventory

_Last updated: 2026-03-12_

This doc is a repo-specific inventory of the most important Effect migration smells currently visible under `src/effect/*`.

Use it together with:

- `docs/effect-migration-slop-patterns.md` for pattern definitions and cleanup direction
- `docs/effect-refactor-task-plan.md` for sequencing / ownership / parallel-agent suitability
- `vendor/effect-smol/LLMS.md` and linked `ai-docs` for the target Effect shape
- `sgconfig.yml` + `ast-grep/rules/*` + `ast-grep/rule-tests/*` for the current automated guardrails

## Current automated guardrails

There is now a local ast-grep rule pack for recurring repo-specific slop smells.

Key paths:

- `sgconfig.yml`
- `ast-grep/rules/*.yml`
- `ast-grep/rule-tests/*.yml`
- `vendor/ast-grep/*` (local ast-grep submodule checkout used as the rule-authoring reference)

Helpful commands:

```bash
bun run lint:effect-slop
bun run test:effect-slop-rules
```

These are reminder/guardrail rules, not a claim that every reported site can be fixed blindly without reading context.

## How to read this doc

- A “smell” does **not** always mean “delete immediately”.
- Some boundary adapters are allowed to stay transitional for a while.
- The real issue is when boundary-oriented code leaks into internal runtime/orchestration logic.

## High-priority smells

## 1) Auth/session details leaking into callers

### What it looks like

Callers handle cookies or low-level Gemini-web availability directly.

### Why it is a smell

- leaks transport/auth internals into orchestration code
- duplicates fallback policy across callers
- makes `CookieMap` part of higher-level contracts
- prevents one clear place from defining unavailable vs failed semantics

### Evidence

- `src/effect/fetch-content-runtime.ts`
  - deps expose `isGeminiWebAvailable` + `queryWithCookies`
  - callers explicitly load cookies, swallow failures, and null-check before querying
- `src/effect/gemini-search.ts`
  - deps expose `isGeminiWebAvailable` + `queryWithCookies`
  - search logic handles auth availability directly
- `src/effect/video-extract.ts`
  - calls Promise wrappers `isGeminiWebAvailable()` + `queryWithCookies(...)`
- `src/effect/youtube-extract.ts`
  - same pattern as local video extraction

### Preferred refactor direction

Introduce a `GeminiWebClient` service that hides cookies and exposes higher-level operations such as:

- `query`
- `queryIfAvailable`
- `queryFailOpen`

## 2) Broad fail-open recovery duplicated at call sites

### What it looks like

Code repeatedly does:

- `Effect.catch(() => Effect.succeed(null))`
- `Effect.catchDefect(() => Effect.succeed(null))`

### Why it is a smell

- duplicates policy across files
- mixes expected failure with programmer defects
- loses observability and intent
- makes behavior inconsistent between callers

### Evidence

- `src/effect/fetch-content-runtime.ts`
  - multiple `catch(...)->null` and `catchDefect(...)->null` fallbacks
- `src/effect/gemini-search.ts`
  - several repeated fail-open wrappers around Gemini API/Web attempts

### Preferred refactor direction

Centralize fail-open behavior inside a dedicated service method or adapter.

Use:

- `catchTag` / `catchTags` for specific expected failures
- explicit “strict” vs “fail-open” APIs
- defects swallowed only if there is a very strong, documented reason

## 3) `unknown` error channels in internal Effect deps

### What it looks like

Effect dependencies expose `Effect.Effect<..., unknown>` instead of typed error channels.

### Why it is a smell

- forces broad `Effect.catch(...)`
- weakens composition and recovery logic
- hides domain meaning at call sites

### Evidence

- `src/effect/fetch-content-runtime.ts`
- `src/effect/gemini-search.ts`
- `src/effect/fetch-content.ts`
- `src/effect/index.ts`
- `src/effect/gemini-web.ts` (`readCookies` dependency)

### Preferred refactor direction

Push typed tagged errors outward from provider/service boundaries.

## 4) Raw `fetch` / `Response` leaking into orchestration modules

### What it looks like

Dependencies or modules work directly with:

- `fetch`
- `RequestInit`
- `Response`
- ad-hoc `response.ok` checks
- manual `text()` / `json()` / `arrayBuffer()` parsing

### Why it is a smell

- transport details leak into domain flow
- retry/timeouts/status handling become inconsistent
- harder to layer middleware / headers / observability
- harder to schema-decode at the boundary

### Evidence

- `src/effect/fetch-content-runtime.ts`
  - deps expose `readonly fetch: (...) => Promise<Response>`
  - manual response parsing helpers
- `src/effect/gemini-search.ts`
  - deps expose `fetch`
- `src/effect/gemini-api.ts`
  - raw `fetch` in core helper
- `src/effect/gemini-web.ts`
  - several raw `fetch` calls inside Effect code
- `src/effect/video-extract.ts`
  - raw upload/poll/delete `fetch`
- `src/effect/youtube-extract.ts`
  - raw thumbnail `fetch`

### Preferred refactor direction

Move transport behind Effect `HttpClient`-based services where practical.

## 5) Raw JSON casts / schema gaps at external boundaries

### What it looks like

- `response.json() as Promise<T>`
- raw `as { ... }` casts after HTTP responses

### Why it is a smell

- trusts external payloads without validation
- turns boundary issues into downstream bugs
- makes error reporting worse

### Evidence

- `src/effect/fetch-content-runtime.ts`
  - `response.json() as Promise<A>`
- `src/effect/gemini-search.ts`
  - `response.json() as Promise<GeminiSearchResponse>`
- `src/effect/video-extract.ts`
  - raw cast for Gemini upload response JSON

### Preferred refactor direction

Use `Schema` at the network boundary and keep decoded types flowing inward.

## 6) Internal Effect modules composing Promise wrappers

### What it looks like

One internal Effect-owned module calls another internal module’s Promise wrapper instead of its Effect export.

### Why it is a smell

- reintroduces Promise-first control flow inside Effect code
- weakens typed error handling and composability
- spreads boundary wrappers inward

### Evidence

- `src/effect/video-extract.ts`
  - calls `isGeminiWebAvailable()` and `queryWithCookies(...)`
- `src/effect/youtube-extract.ts`
  - same pattern

### Preferred refactor direction

If a sibling module already exposes `...Effect`, compose that directly.

## 7) Sync fs / sync process usage in core runtime paths

### What it looks like

- `execFileSync`
- `readFileSync`
- `existsSync`
- `statSync`
- `readdirSync`

### Why it is a smell

- blocks the runtime
- resists testing/injection
- bypasses Effect resource/error patterns

### Biggest hotspots

- `src/effect/github-extract.ts`
- `src/effect/video-extract.ts`
- `src/effect/youtube-extract.ts`
- `src/effect/gemini-api.ts`
- `src/effect/gemini-web.ts`
- `src/effect/fetch-content-config.ts`
- `src/effect/core/Config.ts`

### Preferred refactor direction

- `ChildProcessSpawner` for subprocesses
- Effect/config services for config reads
- Effect-wrapped filesystem/service boundaries for fs-heavy logic

## 8) `null` / sentinel unions carrying operational failure

### What it looks like

- many `return null`
- unions like `number | { error: string }`
- out-of-band success/error objects in internal code

### Why it is a smell

- mixes “not applicable” with “operation failed”
- weakens recovery logic
- encourages silent swallowing

### Biggest hotspots

- `src/effect/fetch-content-runtime.ts`
- `src/effect/video-extract.ts`
- `src/effect/youtube-extract.ts`
- `src/effect/github-api.ts`
- `src/effect/github-extract.ts`
- `src/effect/rsc-extract.ts`

### Preferred refactor direction

Use the Effect error channel internally, then adapt to `null`/legacy contracts only at the outer boundary.

## 9) Config reads embedded inside runtime helpers

### What it looks like

Helpers synchronously read and cache config JSON from `~/.pi/web-search.json` inside runtime modules.

### Why it is a smell

- config is not clearly modeled as a dependency
- tests have to reach around module state/cache
- encourages duplicated config loading patterns

### Evidence

- `src/effect/fetch-content-config.ts`
- `src/effect/gemini-api.ts`
- `src/effect/core/Config.ts`
- runtime helpers that call those readers directly

### Preferred refactor direction

Prefer `Config`, `ConfigProvider`, `ServiceMap.Reference`, or `Layer.unwrap`.

## 10) Overgrown orchestration modules with transport/provider details mixed in

### What it looks like

A runtime/orchestrator file knows too much about:

- auth availability
- transport wiring
- response parsing
- provider-specific fallbacks
- domain orchestration

all in one place.

### Why it is a smell

- hard to test one concern at a time
- API changes ripple through multiple layers
- service boundaries stay fuzzy

### Biggest hotspot

- `src/effect/fetch-content-runtime.ts`

This file is not “bad” overall — it already uses `Effect.fn` and explicit deps in a lot of places — but it is still carrying too much transport/provider detail.

## Current hotspot summary

Quick prioritization snapshot:

| File | Why it is hot |
| --- | --- |
| `src/effect/video-extract.ts` | many async exports, sync process/fs, raw fetch, many `null` paths |
| `src/effect/github-extract.ts` | huge sync fs/process usage + many silent catches |
| `src/effect/youtube-extract.ts` | similar to video path and likely shares abstractions |
| `src/effect/fetch-content-runtime.ts` | orchestration mixed with transport/auth details |
| `src/effect/github-api.ts` | Promise-heavy boundary logic + null-driven flow |
| `src/effect/gemini-web.ts` | good transitional module, but still needs service/HTTP cleanup |

## Smells that are lower priority or may be acceptable at boundaries

These should be reviewed before changing blindly:

- `Effect.runPromise*` at CLI/tool boundaries
- compatibility Promise wrappers that sit at an explicit edge
- fail-open observability behavior
- adapter-level `null` results that truly mean “feature unavailable / not applicable”

## Suggested order of attack

1. Freeze Gemini Web service semantics so auth/cookie policy stops leaking outward.
2. Refactor callers to consume the service instead of cookies.
3. Move high-value HTTP paths toward `HttpClient`.
4. Clean media extraction (`video-extract.ts`, `youtube-extract.ts`).
5. Clean GitHub extraction (`github-api.ts`, `github-extract.ts`).
6. Clean config surfaces.

## Handy queries

```bash
rg -n "Effect\.catchDefect\(\(\) => Effect\.succeed\(null\)\)|Effect\.catch\(\(\) => Effect\.succeed\(null\)\)" src/effect -g '*.ts'
rg -n "Effect\.Effect<[^>]*unknown|Effect\.Effect<.*unknown" src/effect -g '*.ts'
rg -n "CookieMap|isGeminiWebAvailable|queryWithCookies" src/effect -g '*.ts'
rg -n "response\.json\(\) as|as Promise<|response\.text\(|response\.arrayBuffer\(" src/effect -g '*.ts'
rg -n "execFileSync|readFileSync|existsSync|statSync|readdirSync" src/effect -g '*.ts'
```
