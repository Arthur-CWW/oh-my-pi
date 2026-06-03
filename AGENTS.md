# AGENTS.md

## Project

`pi-workflows` is a TypeScript monorepo for Pi extensions, skills, local archives, and AI/video workflows.

Current packages:

- `packages/web-access` — Pi tools for web search, content fetching, YouTube transcripts, Chrome cookies, Codex session import, and frontend LLM browser sessions.
- `packages/browser-use` — clean-room CDP browser-use extension prototype.
- `packages/twitter-archive` — local-first Twitter/X archive schema and future capture/search helpers.
- `apps/tweet-viewer` — future local archive viewer.
- `workflows/*` — future archive/analyze/generate shortform-video workflows.

The repo root is also a Pi package. `.pi/settings.json` points at `..`, and the root `package.json` `pi` manifest loads `packages/web-access/src/index.ts` and `packages/web-access/skills`.

## Commands

```bash
pi --help                         # verify project Pi package loads
bun run typecheck                 # delegates to packages/web-access
bun run test                      # delegates to packages/web-access
bun run check                     # typecheck + tests
bun run web-access:smoke          # live tool smoke test
bun run web-access:help           # verify extension directly
```

## Files

```txt
packages/web-access/
  src/
    index.ts      Pi extension entrypoint (tools + commands)
    schemas.ts    Effect Schema types + errors
    config.ts     ~/.pi/web-search.json reader
    store.ts      JSON file KV store with TTL
    cookies.ts    Chrome cookie extraction (macOS Keychain + CDP)
    gemini.ts     Gemini API + Web client
    kagi.ts       Kagi search (Firefox cookies or Chrome CDP)
    search.ts     web_search (Kagi-first, Gemini fallback)
    fetch.ts      fetch_content (HTTP/Readability → Jina → Gemini)
    youtube.ts    YouTube transcript extraction (yt-dlp)
    codex.ts      Codex CLI session listing/import and `/codex-resume`
    frontend-browser.ts  frontend LLM browser automation
  test/
  vendor/kagi-chrome-extension/   Official Kagi extension (submodule)

packages/twitter-archive/         Local archive schema/capture package skeleton
apps/tweet-viewer/                Local archive viewer skeleton
docs/twitter-archive-plan.md      Twitter/X archive and shortform pipeline plan
```

## Effect v4 patterns

- `Effect.fn` for effectful functions (no `Return` annotation, let inference work)
- `Schema.TaggedErrorClass` for typed errors
- `Effect.retry(Schedule.recurs(1))` for retry
- `Result.isSuccess()` / `.success` for result handling
- Only `Effect.runPromise` at Pi harness boundary (`index.ts`)

## Persistent Preferences

- `moduleResolution: "bundler"` — no `.js` import extensions
- `bun-types` in package typecheck configs for tests
- Cross-runtime: avoid native modules unless deliberately isolated
- Kagi auth: `X-Kagi-Authorization` header (matching official extension)
- Tests close to source in package `test/` directories
- No colocated `*.test.ts` beside impl files
- Twitter/X capture should be respectful: low concurrency, jitter/backoff, disk cache/entity dedupe, no private/locked content
- Browser-based Twitter/X scraping should inspect only the main content/tweet column plus search input; ignore sidebars/trends/DMs/navigation chrome
