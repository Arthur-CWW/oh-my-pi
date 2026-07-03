# packages/web-access

Pi extension bundle (`@wirebabel/pi-web-access`): web search, content fetching, YouTube transcripts, browser integration, and the vim-lite editor.

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
  index.ts             entrypoint: registers tools + vim-lite
  schemas.ts           Effect Schema types + errors
  config.ts            ~/.pi/web-search.json reader
  store.ts             JSON file KV store with TTL
  search.ts            web_search tool (Kagi-first, Gemini fallback)
  fetch.ts             fetch_content tool (cascade: HTTP/Readability → Jina → Chrome → Gemini)
  youtube.ts           YouTube transcript extraction (yt-dlp)
  kagi.ts              Kagi search client (auth: X-Kagi-Authorization header)
  gemini.ts            Gemini API client
  cookies.ts           Browser cookie integration (macOS)
  cua-driver.ts        CuaDriver CLI wrapper
  codex.ts             Codex session listing/import, /codex-resume command
  vim-lite.ts          Vim-like modal editor, /vim-lite command
  frontend-browser.ts  Frontend LLM browser automation
test/                  Tests + vim-lite snapshots
vendor/kagi-chrome-extension/  Kagi extension submodule (reference)
```

## vim-lite

Registered via `registerVimLite(pi)` in `index.ts`. Commands: `/vim-lite` (enable), `/vim-lite off` (disable), `/vim-lite help` (show), `/vim-lite hide` (dismiss help). Yanks (`y`/`yy`/`Y`/visual `y`) write to system clipboard; deletes only touch internal register unless explicit register used. `"+p` pastes system clipboard.

Tests: `test/vim-lite.test.ts` + `test/__snapshots__/vim-lite-visual.snap.txt`.
