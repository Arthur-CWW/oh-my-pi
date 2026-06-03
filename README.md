# Pi Web Access

Web search, content fetching, YouTube transcripts, Chrome cookie access, and Codex session import for Pi coding agent.

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

### CLI

The CLI defaults to Kagi and reads your local Firefox Kagi session:

```bash
pi-web-search "effect ts getting started"
bun run search "effect ts getting started"       # local dev
bun run kagi-search "effect ts getting started"  # explicit Kagi
```

Use `--refresh-session` to force re-reading Firefox cookies, or `--provider fallback` to allow Gemini fallback.

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

### chatgpt_handoff

Copy a prompt to your clipboard and open ChatGPT in Firefox for a manual Pro run. This intentionally does not submit prompts or scrape responses.

```typescript
chatgpt_handoff({ prompt: "draft a research plan" })
chatgpt_handoff({ prompt: "continue this", conversationUrl: "https://chatgpt.com/c/..." })
chatgpt_handoff({ prompt: "work in this project", projectUrl: "https://chatgpt.com/..." })
```

CLI:

```bash
pi-chatgpt "draft a research plan"
bun run chatgpt -- --copy-only --prompt-file prompt.md
```

### codex_session and `/codex-resume`

List or extract recent Codex CLI sessions from `~/.codex/sessions` so Pi can continue prior Codex work.

```typescript
codex_session({ action: "list" })
codex_session({ action: "show", session: "latest", maxChars: 50000 })
```

User command:

```text
/codex-resume                 # import latest Codex session for this cwd and continue
/codex-resume --pick          # choose from recent sessions for this cwd
/codex-resume --all --pick    # choose from all Codex sessions
/codex-resume --no-send       # import hidden context and prefill the editor
```

The importer adds the Codex transcript as hidden Pi context, asks Pi to re-check repo state before editing, and redacts obvious API key/token patterns.

### llm_frontend_browser

Launch or inspect a dedicated Helium/Chromium CDP profile for frontend LLM sites. Use `setup` once for login, then `open`/future automation can reuse the same logged-in profile in the background. Prompt sessions and saved project aliases are stored locally in `~/.pi/pi-web-access/frontend-browser.sqlite`.

```typescript
llm_frontend_browser({ action: "setup", provider: "aistudio" })
llm_frontend_browser({ action: "google-login", provider: "aistudio" })
llm_frontend_browser({ action: "chatgpt-login" })
llm_frontend_browser({ action: "prompt", provider: "aistudio", prompt: "Return exactly: ok" })
llm_frontend_browser({ action: "prompt", provider: "chatgpt", prompt: "Return exactly: ok" })
llm_frontend_browser({ action: "save-project", provider: "chatgpt", projectKey: "youtube-video-essay", projectUrl: "https://chatgpt.com/project/..." })
llm_frontend_browser({ action: "prompt", provider: "chatgpt", project: "youtube-video-essay", prompt: "Continue the project brief" })
llm_frontend_browser({ action: "prompt", provider: "chatgpt", session: "latest", prompt: "Continue from the last answer" })
llm_frontend_browser({ action: "prompt", provider: "chatgpt", prompt: "Deep research question", waitForResponse: false })
llm_frontend_browser({ action: "wait", provider: "chatgpt", session: "latest", responseTimeoutMs: 900000, outputFile: "research.md" })
llm_frontend_browser({ action: "collect", provider: "chatgpt", session: "latest" })
llm_frontend_browser({ action: "sessions", provider: "chatgpt", project: "youtube-video-essay" })
llm_frontend_browser({ action: "open", provider: "deepseek", background: true })
llm_frontend_browser({ action: "status", provider: "chatgpt" })
```

`action: "prompt"` currently supports AI Studio and ChatGPT. `action: "collect"`/`"wait"` currently supports ChatGPT conversations. It will not accept terms of service, solve CAPTCHA, or bypass account challenges; those states return `needsHuman: true`.

For expensive ChatGPT Pro research, prefer async submission: call `prompt` with `waitForResponse: false`, keep the returned session/conversation URL, then call `wait` later. If the browser/CDP connection breaks, ChatGPT usually continues server-side; use `collect`/`wait` with the saved session or conversation URL to recover the finished response.

For generic Playwright/Puppeteer/CDP work, load the `background-browser-automation` skill. It documents focus-safe browser automation and API/network reversing without opening DevTools UI.

CLI:

```bash
pi-llm-browser setup --provider aistudio
pi-llm-browser google-login
pi-llm-browser chatgpt-login
pi-llm-browser prompt --provider aistudio "Return exactly: ok"
pi-llm-browser prompt --provider chatgpt "Return exactly: ok"
pi-llm-browser prompt --provider aistudio --prompt-file prompt.md --response-timeout-ms 180000
pi-llm-browser prompt --provider chatgpt --no-wait "Deep research question"
pi-llm-browser wait --provider chatgpt --session latest --response-timeout-ms 900000 --output-file research.md
pi-llm-browser collect --provider chatgpt --session latest
pi-llm-browser projects --provider chatgpt --save-project youtube-video-essay --project-url https://chatgpt.com/project/...
pi-llm-browser prompt --provider chatgpt --project youtube-video-essay --prompt-file prompt.md
pi-llm-browser prompt --provider chatgpt --continue "Continue from the previous answer"
pi-llm-browser sessions --provider chatgpt --project youtube-video-essay
pi-llm-browser open --provider deepseek --background
pi-llm-browser status --provider chatgpt
```

## How it works

```
web_search → Kagi SSE (Firefox cookies) → Gemini API (grounding)
fetch_content → HTTP + Readability → Jina Reader → Gemini API → Gemini Web
youtube_transcript → yt-dlp (metadata + auto-generated captions)
chrome_cookies → macOS Keychain (Chrome SQLite) → Chrome DevTools CDP
chatgpt_handoff → pbcopy → open ChatGPT in Firefox for manual submission
codex_session / /codex-resume → ~/.codex/sessions JSONL → hidden Pi context + resume prompt
llm_frontend_browser → open -g Helium → Chrome DevTools Protocol profile/tab reuse → frontend prompt automation → local SQLite sessions → collect/wait recovery
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
bun test ./test          # 33 tests
bun run scripts/smoke.ts # live tool check
pi -e ./src/index.ts --help
```

## Requirements

- macOS for zero-config cookie access (Linux works with `--remote-debugging-port=9222`)
- `yt-dlp` for YouTube transcripts (`brew install yt-dlp`)
- Kagi account (signed into Firefox or Chrome)
