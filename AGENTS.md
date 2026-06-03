# AGENTS.md

## Project

Pi extension providing web search, content fetching, YouTube transcripts, and Chrome cookie access.

- Entry: `src/index.ts` — registers Pi tools and commands
- Runtime: Node.js (Pi) and Bun (dev/tests)
- Store: JSON file at `~/.pi/pi-web-access/store.json` (24h TTL)

## Commands

```bash
bun run typecheck    # tsc --noEmit
bun test ./test      # 27 tests
bun run scripts/smoke.ts  # live tool smoke test
pi -e ./src/index.ts --help   # verify extension loads
pi install . -l      # install locally for testing
```

## Files

```
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

test/
  basic.test.ts    Core tool tests (7)
  store.test.ts    JSON store tests (9)
  kagi.test.ts     Kagi parsing + live test (7)
  platform.test.ts Cross-platform path detection (4)
  codex.test.ts    Codex session parser/import tests (3)

vendor/kagi-chrome-extension/   Official Kagi extension (submodule)
```

## Effect v4 patterns

- `Effect.fn` for effectful functions (no `Return` annotation, let inference work)
- `Schema.TaggedErrorClass` for typed errors
- `Effect.retry(Schedule.recurs(1))` for retry
- `Result.isSuccess()` / `.success` for result handling
- Only `Effect.runPromise` at Pi harness boundary (`index.ts`)

## Persistent Preferences

- `moduleResolution: "bundler"` — no `.js` import extensions
- `bun-types` in `tsconfig.typecheck.json` for test typecheck
- Cross-runtime: no native modules (JSON file store instead of SQLite)
- Kagi auth: `X-Kagi-Authorization` header (matching official extension)
- Tests close to source: `test/` directory
- No colocated `*.test.ts` beside impl files
