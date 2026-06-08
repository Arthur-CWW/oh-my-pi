# AGENTS.md

## Project

`pi-workflows` is a TypeScript monorepo for Pi extensions, skills, local archives, and AI/video workflows.

Current packages:

- `packages/web-access` — Pi tools for web search, content fetching, YouTube transcripts, Chrome cookies, Codex session import, frontend LLM browser sessions, and the `vim-lite` Pi input editor.
- `packages/dynamic-workflows` — vendored `pi-dynamic-workflows` source/tests plus local adversarial-review prompt template; the released `npm:pi-dynamic-workflows` package is installed project-locally for the active workflow tool.
- `packages/browser-use` — clean-room CDP browser-use extension prototype.
- `packages/twitter-archive` — local-first Twitter/X archive schema and future capture/search helpers.
- `packages/jimeng-client` — Jimeng/Dreamina direct API helpers ported from Slotok reverse engineering.
- `apps/tweet-viewer` — future local archive viewer.
- `workflows/*` — future archive/analyze/generate shortform-video workflows.

The repo root is also a Pi package. `.pi/settings.json` points at `..` and `npm:pi-dynamic-workflows`. The root `package.json` `pi` manifest loads `packages/web-access/src/index.ts`, `packages/web-access/skills`, and the local dynamic-workflows prompt templates.

## Commands

```bash
pi --help                         # verify project Pi package loads
bun run typecheck                 # delegates to packages/web-access
bun run test                      # delegates to packages/web-access
bun run check                     # typecheck + tests + lint
bun run lint                      # all repo lint guardrails
bun run lint:unsafe-types         # ratcheted no any/unknown/Any lint
bun run jimeng:test               # Jimeng direct-client unit tests
bun run web-access:smoke          # live tool smoke test
bun run web-access:help           # verify extension directly
bun run dynamic-workflows:test     # dynamic workflow parser/runtime tests
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
    fetch.ts      fetch_content (HTTP/Readability → Jina → background Chrome → Gemini)
    youtube.ts    YouTube transcript extraction (yt-dlp)
    codex.ts      Codex CLI session listing/import and `/codex-resume`
    vim-lite.ts   Vim-like modal Pi input editor registered as `/vim-lite`
    frontend-browser.ts  frontend LLM browser automation
  test/            package tests, including `vim-lite.test.ts` + snapshots
  vendor/kagi-chrome-extension/   Official Kagi extension (submodule)

packages/dynamic-workflows/       Vendored workflow source/tests plus adversarial-review prompt
packages/twitter-archive/         Local archive schema/capture package skeleton
packages/jimeng-client/           Jimeng/Dreamina direct API helpers
apps/tweet-viewer/                Local archive viewer skeleton
docs/twitter-archive-plan.md      Twitter/X archive and shortform pipeline plan
```

## Pi vim-lite editor extension

- Source: `packages/web-access/src/vim-lite.ts`; registered from `packages/web-access/src/index.ts` with `registerVimLite(pi)` and loaded by the root `package.json` Pi manifest.
- Command: `/vim-lite` enables it, `/vim-lite off|disable` restores Pi's stock editor, `/vim-lite help` shows in-TUI help, `/vim-lite hide` hides that help.
- Clipboard behavior: plain Vim yanks (`y`, `yy`, `Y`, visual `y`) write to the system clipboard by default; `"+p` pastes from the system clipboard. Deletes/changes only update the internal register unless an explicit register is used.
- Tests: `packages/web-access/test/vim-lite.test.ts` and `packages/web-access/test/__snapshots__/vim-lite-visual.snap.txt`.

## Effect v4 patterns

- `Effect.fn` for effectful functions (no `Return` annotation, let inference work)
- `Schema.TaggedErrorClass` for typed errors
- `Effect.retry(Schedule.recurs(1))` for retry
- `Result.isSuccess()` / `.success` for result handling
- Only `Effect.runPromise` at Pi harness boundary (`index.ts`)

## Persistent Preferences

- For video/creative/AI UGC work, read and maintain `docs/state/README.md` and `docs/state/video-creative-direction.md`; when Arthur gives new durable preferences or direction in a session, update the relevant state doc so it stays synchronized.
- When composing Pi/LLM handoff prompts, use `@path/to/file` references where supported to auto-include maintained context docs instead of copying them manually.
- `moduleResolution: "bundler"` — no `.js` import extensions
- `bun-types` in package typecheck configs for tests
- Cross-runtime: avoid native modules unless deliberately isolated
- Do not introduce explicit TypeScript `any`/`unknown` or Python `Any` outside typed boundary modules; use `bun run lint:unsafe-types`.
- External API/process/file data should be decoded at the boundary with a schema/parser before entering core code; DB access should use generated/inferred row types or decode rows in the repository layer.
- Kagi auth: `X-Kagi-Authorization` header (matching official extension)
- Tests close to source in package `test/` directories
- No colocated `*.test.ts` beside impl files
- Twitter/X capture should be respectful: low concurrency, jitter/backoff, disk cache/entity dedupe, no private/locked content
- Browser-based Twitter/X scraping should inspect only the main content/tweet column plus search input; ignore sidebars/trends/DMs/navigation chrome
- Jimeng live/direct runs can consume paid quota; run dry-run plans first, keep concurrency 1, and stop on risk-control (`1019` / `shark not pass`) errors
