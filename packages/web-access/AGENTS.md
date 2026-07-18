# packages/web-access

Pi extension bundle (`@wirebabel/pi-web-access`): web search, content fetching, YouTube transcripts, and browser integration.

## Build

```bash
bun run typecheck    # from repo root, or bun check here
bun run test         # from repo root
bun run web-access:smoke  # live tool smoke test
bun run web-access:help   # verify extension loads
```

## Source map

```
src/
  index.ts             entrypoint: registers tools
  schemas.ts           Effect Schema types + errors
  config.ts            ~/.pi/web-search.json reader
  store.ts             JSON file KV store with TTL
  search.ts            web_search tool (Kagi-first, Gemini fallback)
  fetch.ts             fetch_content tool (cascade: HTTP/Readability → Jina → Chrome → Gemini)
  youtube.ts           YouTube transcript extraction (yt-dlp)
  kagi.ts              Kagi search client (auth: X-Kagi-Authorization header)
  gemini.ts            Gemini API client
  cookies.ts           Browser cookie integration (macOS)
  codex.ts             Codex session listing/import, /codex-resume command
  frontend-browser.ts  Frontend LLM browser automation
test/                  Tests
vendor/kagi-chrome-extension/  Kagi extension submodule (reference)
```

