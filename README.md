# Pi Web Access

Web search, content fetching, YouTube transcripts, and Chrome cookie access for Pi coding agent.

Works with **zero config** on macOS — reads Chrome cookies for Gemini and Firefox cookies for Kagi. No API keys needed.

## Install

```bash
pi install npm:@wirebabel/pi-web-access
```

Or for local development:

```bash
git clone https://github.com/Arthur-CWW/pi-web-access.git
cd pi-web-access && bun install
pi install . -l
```

## Tools

### web_search

Search the web via Kagi (default) with Gemini fallback. Kagi reads your session from Firefox cookies; Gemini uses Chrome cookies or an API key.

```typescript
web_search({ query: "effect ts getting started" })
web_search({ query: "latest news", provider: "gemini" })
```

### fetch_content

Fetch URL(s) and extract readable content as markdown. Falls back through Jina Reader and Gemini when pages block extraction.

```typescript
fetch_content({ url: "https://example.com/article" })
fetch_content({ urls: ["url1", "url2"] })
```

### get_search_content

Retrieve full content stored from a previous `web_search` or `fetch_content` call.

```typescript
get_search_content({ responseId: "abc123", urlIndex: 0 })
```

### chrome_cookies

Check Google/Gemini cookie availability from your local Chrome profile.

```typescript
chrome_cookies()
```

### youtube_transcript

Extract video title, description, and transcript with timestamps from YouTube. Requires `yt-dlp` (`brew install yt-dlp`).

```typescript
youtube_transcript({ url: "https://www.youtube.com/watch?v=..." })
```

## How it works

```
web_search → Kagi SSE (Firefox cookies) → Gemini API (grounding)
fetch_content → HTTP + Readability → Jina Reader → Gemini API → Gemini Web
youtube_transcript → yt-dlp (metadata + auto-generated captions)
chrome_cookies → macOS Keychain (Chrome SQLite) → Chrome DevTools CDP
```

## Configuration

Optional `~/.pi/web-search.json`:

```json
{
  "geminiApiKey": "AIza...",
  "provider": "kagi"
}
```

Set `CHROME_DEBUG_URL` to your Chrome DevTools endpoint (default: `http://localhost:9222`).

## Testing

```bash
bun run typecheck
bun test ./test          # 27 tests
bun run scripts/smoke.ts # live smoke test
pi -e ./src/index.ts --help
```

## Requirements

- macOS for zero-config cookie access (Linux works with `--remote-debugging-port=9222`)
- `yt-dlp` for YouTube transcripts (`brew install yt-dlp`)
- Kagi account (signed into Firefox or Chrome)
