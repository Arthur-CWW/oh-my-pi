
# Pi Web Access

**Web search, content extraction, and video understanding for Pi agent. Zero config with Chrome, or bring your own API keys.**

[![npm version](https://img.shields.io/npm/v/pi-web-access?style=for-the-badge)](https://www.npmjs.com/package/pi-web-access)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows*-blue?style=for-the-badge)]()

https://github.com/user-attachments/assets/cac6a17a-1eeb-4dde-9818-cdf85d8ea98f

## Why Pi Web Access

**Zero Config** — Signed into Google in Chrome? That's it. The extension reads your Chrome session cookies to access Gemini directly. No API keys, no setup, no subscriptions.

**Video Understanding** — Point it at a YouTube video or local screen recording and ask questions about what's on screen. Full transcripts, visual descriptions, and frame extraction at exact timestamps.

**Smart Fallbacks** — Every capability has a fallback chain. Search defaults to Kagi (session-based), then falls back to Gemini. YouTube and page extraction retry through Gemini and Jina-based paths when direct extraction fails.

**GitHub Cloning** — GitHub URLs are cloned locally instead of scraped. The agent gets real file contents and a local path to explore, not rendered HTML.

## Install

```bash
pi install npm:pi-web-access
```

### Local development install (this repo)

If you want to test changes from a local clone instead of npm:

```bash
npm install
pi remove npm:pi-web-access          # avoid duplicate tool/command conflicts
pi install . -l                      # install into this project's .pi/settings.json
```

If you're not signed into Chrome, add API keys to `~/.pi/web-search.json`:

```json
{
  "geminiApiKey": "AIza..."
}
```

`geminiApiKey` powers Gemini fallback/search paths. If `provider` is omitted, `web_search` uses the default Kagi-first fallback flow, then Gemini (API/Web fallback chain).

Optional dependencies for video frame extraction:

```bash
brew install ffmpeg   # frame extraction, video thumbnails, local video duration
brew install yt-dlp   # YouTube stream URLs for frame extraction
```

Without these, video content analysis (transcripts, visual descriptions via Gemini) still works. The binaries are only needed for extracting individual frames as images.

Requires Pi v0.37.3+.

## Quick Start

```typescript
// Search the web
web_search({ query: "TypeScript best practices 2025" })

// Fetch a page
fetch_content({ url: "https://docs.example.com/guide" })

// Clone a GitHub repo
fetch_content({ url: "https://github.com/owner/repo" })

// Understand a YouTube video
fetch_content({ url: "https://youtube.com/watch?v=abc", prompt: "What libraries are shown?" })

// Analyze a screen recording
fetch_content({ url: "/path/to/recording.mp4", prompt: "What error appears on screen?" })
```

## Direct CLI (Bun)

The core modules can also run directly from the terminal with Bun:

```bash
bun scripts/kagi-search-cli.ts "effect ts" --lens programming --json
bun src/effect/gemini-search.ts --query "effect ts" --provider gemini
bun src/effect/chrome-cookies.ts --names __Secure-1PSID,__Secure-1PSIDTS
bun packages/legacy-web-access/src/extract.ts https://example.com/article --json
```

Use `--help` on each file for available flags. Note: `packages/legacy-web-access/src/extract.ts` remains the direct CLI shim while `fetch_content` itself is now registered from the Effect entrypoint.

## Testing

```bash
bun run typecheck
bun run test
```

The test runner discovers both the historical top-level `tests/` suite and colocated tests under `src/` / `packages/`.

## Tools

### web_search

Search the web with Kagi-first routing (default), with Gemini fallback. Returns a synthesized answer plus source links.

```typescript
web_search({ query: "rust async programming" })
web_search({ query: "latest news", recencyFilter: "week" })
web_search({ query: "...", domainFilter: ["github.com"] })
web_search({ query: "...", provider: "kagi", lens: "programming" })
web_search({ query: "...", provider: "gemini" })
```

| Parameter | Description |
|-----------|-------------|
| `query` | Single query string |
| `provider` | Optional: `kagi` or `gemini`. Omit it for the default Kagi-first fallback flow. |
| `lens` | Kagi lens key (e.g. `programming`, `academic`, `news_360`) |
| `numResults` | Requested result count (1-20) |
| `recencyFilter` | `day`, `week`, `month`, or `year` |
| `domainFilter` | Limit query to domains (translated to `site:` filters for Kagi path) |

### fetch_content

Fetch URL(s) and extract readable content as markdown. Automatically detects and handles GitHub repos, YouTube videos, PDFs, local video files, and regular web pages.

```typescript
fetch_content({ url: "https://example.com/article" })
fetch_content({ urls: ["url1", "url2", "url3"] })
fetch_content({ url: "https://github.com/owner/repo" })
fetch_content({ url: "https://youtube.com/watch?v=abc", prompt: "What libraries are shown?" })
fetch_content({ url: "/path/to/recording.mp4", prompt: "What error appears on screen?" })
fetch_content({ url: "https://youtube.com/watch?v=abc", timestamp: "23:41-25:00", frames: 4 })
```

| Parameter | Description |
|-----------|-------------|
| `url` / `urls` | Single URL/path or multiple URLs |
| `prompt` | Question to ask about a YouTube video or local video file |
| `timestamp` | Extract frame(s) — single (`"23:41"`), range (`"23:41-25:00"`), or seconds (`"85"`) |
| `frames` | Number of frames to extract (max 12) |
| `forceClone` | Clone GitHub repos that exceed the 350MB size threshold |

### get_search_content

Retrieve stored content from previous searches or fetches. Content over 30,000 chars is truncated in tool responses but stored in full for retrieval here.

```typescript
get_search_content({ responseId: "abc123", urlIndex: 0 })
get_search_content({ responseId: "abc123", url: "https://..." })
get_search_content({ responseId: "abc123", query: "original query" })
```

## Capabilities

### GitHub repos

GitHub URLs are cloned locally instead of scraped. The agent gets real file contents and a local path to explore with `read` and `bash`. Root URLs return the repo tree + README, `/tree/` paths return directory listings, `/blob/` paths return file contents.

Repos over 350MB get a lightweight API-based view instead of a full clone (override with `forceClone: true`). Commit SHA URLs are handled via the API. Clones are cached for the session and wiped on session change. Private repos require the `gh` CLI.

### YouTube videos

YouTube URLs are processed via Gemini for full video understanding — visual descriptions, transcripts with timestamps, and chapter markers. Pass a `prompt` to ask specific questions about the video. Results include the video thumbnail so the agent gets visual context alongside the transcript.

Fallback: Gemini Web → Gemini API. Handles all URL formats: `/watch?v=`, `youtu.be/`, `/shorts/`, `/live/`, `/embed/`, `/v/`.

### Local video files

Pass a file path (`/`, `./`, `../`, or `file://` prefix) to analyze video content via Gemini. Supports MP4, MOV, WebM, AVI, and other common formats up to 50MB. Pass a `prompt` to ask about specific content. If ffmpeg is installed, a thumbnail frame is included alongside the analysis.

Fallback: Gemini API (Files API upload) → Gemini Web.

### Video frame extraction

Use `timestamp` and/or `frames` on any YouTube URL or local video file to extract visual frames as images.

```typescript
fetch_content({ url: "...", timestamp: "23:41" })                       // single frame
fetch_content({ url: "...", timestamp: "23:41-25:00" })                 // range, 6 frames
fetch_content({ url: "...", timestamp: "23:41-25:00", frames: 3 })      // range, custom count
fetch_content({ url: "...", timestamp: "23:41", frames: 5 })            // 5 frames at 5s intervals
fetch_content({ url: "...", frames: 6 })                                // sample whole video
```

Requires `ffmpeg` (and `yt-dlp` for YouTube). Timestamps accept `H:MM:SS`, `MM:SS`, or bare seconds.

### PDFs

PDF URLs are extracted as text and saved to `~/Downloads/` as markdown. The agent can then `read` specific sections without loading the full document into context. Text-based extraction only — no OCR.

### Blocked pages

When Readability fails or returns only a cookie notice, the extension retries via Jina Reader (handles JS rendering server-side, no API key needed), then Gemini URL Context API, then Gemini Web extraction. Handles SPAs, JS-heavy pages, and anti-bot protections transparently. Also parses Next.js RSC flight data when present.

## How It Works

```
fetch_content(url)
  → Video file?  Gemini API (Files API) → Gemini Web
  → GitHub URL?  Clone repo, return file contents + local path
  → YouTube URL? Gemini Web → Gemini API
  → HTTP fetch → PDF? Extract text, save to ~/Downloads/
               → HTML? Readability → RSC parser → Jina Reader → Gemini fallback
               → Text/JSON/Markdown? Return directly
```

## Skills

### librarian

Bundled research workflow for investigating open-source libraries. Combines GitHub cloning, web search, and git operations (blame, log, show) to produce evidence-backed answers with permalinks. Pi loads it automatically based on your prompt. Also available via `/skill:librarian` with [pi-skill-palette](https://github.com/wirebabel/pi-skill-palette).

## Commands

### /search

Browse stored search/fetch results interactively. Lists stored response IDs and lets you inspect or delete them from the current session.

### Legacy-only command/UI reference

The old browser curator command (`/websearch`) and activity widget now live only in `packages/legacy-web-access/src/index.ts` as migration reference/debug code. They are **not** registered by the default Effect entrypoint (`src/effect/index.ts`).

## Activity Monitor

The activity widget below is part of the legacy reference entrypoint, not the default Effect entrypoint:

```
─── Web Search Activity ────────────────────────────────────
  API  "typescript best practices"     200    2.1s ✓
  GET  docs.example.com/article        200    0.8s ✓
  GET  blog.example.com/post           404    0.3s ✗
────────────────────────────────────────────────────────────
```

## Configuration

All config lives in `~/.pi/web-search.json`. Every field is optional.

The default Effect entrypoint currently uses the `geminiApiKey`, `provider`, `githubClone`, `youtube`, and `video` settings below. Legacy-only curator settings such as `curateWindow`, `autoFilter`, and `shortcuts` still exist for reference/debugging under `packages/legacy-web-access`, but are not used by the default Effect entrypoint.

```json
{
  "geminiApiKey": "AIza...",
  "provider": "kagi",
  "githubClone": {
    "enabled": true,
    "maxRepoSizeMB": 350,
    "cloneTimeoutSeconds": 30,
    "clonePath": "/tmp/pi-github-repos"
  },
  "youtube": {
    "enabled": true,
    "preferredModel": "gemini-3-flash-preview"
  },
  "video": {
    "enabled": true,
    "preferredModel": "gemini-3-flash-preview",
    "maxSizeMB": 50
  }
}
```

`GEMINI_API_KEY` takes precedence over the config file value. `provider` controls the default `web_search` provider preference (`"kagi"` or `"gemini"`); if omitted, the default Kagi-first fallback flow is used.

### Legacy-only shortcut settings

These shortcut settings apply only to the legacy reference entrypoint:

```json
{
  "shortcuts": {
    "curate": "ctrl+shift+s",
    "activity": "ctrl+shift+w"
  }
}
```

Values use the same format as pi keybindings (e.g. `ctrl+s`, `ctrl+shift+s`, `alt+r`). Changes take effect on next pi restart.

### Legacy-only auto-condense

Multi-query auto-condense belongs to the legacy reference entrypoint. The default Effect entrypoint does not currently load that browser-curation flow.

When used from the legacy entrypoint, multi-query searches are automatically condensed into a deduplicated briefing when the countdown expires without manual curation. A single LLM call receives all search results — enriched with preprocessing analysis (URL overlap, answer similarity, source quality tiers) — and produces a concise synthesis organized by topic. Irrelevant or off-topic results are skipped automatically.

```json
{
  "autoFilter": {
    "enabled": true,
    "model": "anthropic/claude-haiku-4-5",
    "prompt": "You are a research assistant..."
  }
}
```

| Field | Description |
|-------|-------------|
| `enabled` | `true` to enable, `false` to disable. Omit `autoFilter` entirely to enable with defaults. |
| `model` | LLM model in `provider/model` format. Uses pi's model registry for auth. Default: `anthropic/claude-haiku-4-5`. |
| `prompt` | System prompt for the condenser. Should instruct the model to synthesize, deduplicate, and cite sources. Omit to use the built-in prompt. |

Shorthand: `"autoFilter": true` or `"autoFilter": false` for enable/disable without customizing model or prompt.

The model uses pi's model registry, so any configured provider works — including custom gateways, OAuth tokens, and API keys. If the model isn't found in the registry or has no credentials, condensation is silently skipped.

The `web_search` tool also accepts an optional `context` parameter — a brief description of the user's current task or goal. When provided, the condenser uses it to focus the briefing (e.g., "building a Shopify checkout extension" helps it emphasize relevant findings over general noise).

Set `"enabled": false` under any feature to disable it. Config changes require a Pi restart.

Content fetches run 3 concurrent with a 30s timeout per URL.

## Troubleshooting

- `Cannot find module '@mozilla/readability'` when loading a local checkout:
  run `npm install` in this repo first.
- `Tool "web_search" conflicts with ...pi-web-access...`:
  you have both npm and local installs enabled. Remove one (`pi remove npm:pi-web-access` or `pi remove .`).

## Limitations

- Chrome cookie extraction uses a macOS local-db path first (Keychain + SQLite), with a cross-platform DevTools fallback (`CHROME_DEBUG_URL`, default `http://localhost:9222`). If no cookies are found, sign into gemini.google.com and retry.
- YouTube private/age-restricted videos may fail on all extraction paths.
- Gemini can process videos up to ~1 hour; longer videos may be truncated.
- PDFs are text-extracted only (no OCR for scanned documents).
- GitHub branch names with slashes may misresolve file paths; the clone still works and the agent can navigate manually.
- Non-code GitHub URLs (issues, PRs, wiki) fall through to normal web extraction.

<details>
<summary>Files</summary>

### Active Effect entry/runtime

| File | Purpose |
|------|---------|
| `src/effect/index.ts` | Active Pi extension entrypoint and tool registration |
| `src/effect/kagi-search.ts` | Kagi-backed search adapter used by `web_search` |
| `src/effect/fetch-content.ts` | Effect-owned `fetch_content` boundary + stored-output shaping |
| `src/effect/search-content.ts` | Effect-owned `get_search_content` retrieval path |
| `src/effect/gemini-search.ts` | Gemini search helpers and fallback orchestration |
| `src/effect/gemini-web.ts` | Gemini Web client (cookie auth) |
| `src/effect/gemini-api.ts` | Gemini REST API client |
| `src/effect/chrome-cookies.ts` | Chrome cookie extraction (macOS + DevTools fallback) |
| `src/effect/search-runtime.ts` | Provider selection / fallback orchestration |
| `src/effect/search-events.ts` | Optional fail-open local search event emission |

### Kagi package workspace

| File | Purpose |
|------|---------|
| `packages/kagi/src/kagi-client.ts` | Unofficial Kagi session/search/runtime helpers |
| `packages/kagi/src/kagi-search-effect.ts` | Effect-native Kagi search boundary + typed provider errors |
| `packages/kagi/src/kagi-client-effect.ts` | Effect-native wrappers for Kagi session/lens/advanced/rules helpers |
| `packages/kagi/src/kagi-query-parser.ts` | Google-style operator parsing for Kagi-compatible search |

### Legacy reference path (still being reduced)

| File | Purpose |
|------|---------|
| `packages/legacy-web-access/src/index.ts` | Legacy extension entry kept for parity/reference |
| `packages/legacy-web-access/src/extract.ts` | Legacy extraction pipeline still backing parts of `fetch_content` internals |
| `packages/legacy-web-access/src/github-extract.ts` | GitHub clone/cache/content generation |
| `packages/legacy-web-access/src/youtube-extract.ts` | YouTube extraction + frame handling |
| `packages/legacy-web-access/src/video-extract.ts` | Local video analysis helpers |
| `packages/legacy-web-access/src/pdf-extract.ts` | PDF text extraction |
| `packages/legacy-web-access/src/rsc-extract.ts` | RSC flight data parser for Next.js pages |
| `packages/legacy-web-access/src/storage.ts` | Session-aware result storage used during migration |
| `skills/librarian/` | Bundled skill for library research |

</details>
