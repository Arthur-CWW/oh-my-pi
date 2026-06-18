# Pi Web Access

Web search, content fetching, YouTube transcripts, Chrome cookie access, and Codex session import for Pi coding agent.

Works with **zero config** on macOS — reads Chrome cookies for Gemini and Firefox cookies for Kagi. No API keys needed.

## Install

```bash
pi install npm:@wirebabel/pi-web-access
```

Or for local development:

```bash
git clone https://github.com/Arthur-CWW/pi-workflows.git
cd pi-workflows && bun install
pi install . -l                # install the root package locally
# or: pi install ./packages/web-access -l
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

Fetch URL(s) and extract readable content as markdown. Falls back through Jina Reader, a background Chrome capture on macOS, and Gemini when pages block extraction.

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

### `/agent-history`

Inspect live, idle, or parked subagent transcripts without reviving the agent. This is the safe path when Agent Hub focus would otherwise wake a parked worker.

```text
/agent-history              # picker for all registered agents
/agent-history <agent-id>   # show one transcript through history://<agent-id>
/agent-history list         # show the history:// index
```


### computer_use

A higher-level, background-safe macOS GUI automation extension backed by CuaDriver. This is the **preferred tool** for safe inspected GUI flows. It enforces policy constraints (blocking destructive commands, hotkeys, and dangerous apps like Terminal) and validates schema before execution.

Always follow the **inspect-act-verify** loop when using `computer_use`:
1. **Inspect**: Call `capture` or `get_app_state` to snapshot the target window layout and obtain element indices.
2. **Act**: Perform mutations such as `click`, `type`, or `key` using the returned `element_index`. Indexed actions require a fresh capture beforehand.
3. **Verify**: Run `capture` again to verify the action succeeded and update the layout state.

Example usage:
```typescript
// 1. Inspect: Get a fresh layout capture
computer_use({ action: "capture", args: { appName: "Safari" } })

// 2. Act: Click on element 42 using its index from the capture
computer_use({ action: "click", args: { elementIndex: 42 } })

// 3. Verify: Snapshot again to verify the state
computer_use({ action: "capture", args: { appName: "Safari" } })
```

*Note: For safe automation, OMP users must prefer `computer_use`. Use the raw `cua_driver` tool only for low-level debugging or when bypass/uninspected flows are explicitly required.*
### cua_driver

Control local macOS apps and browser windows through installed CuaDriver without raising the target app. Use this tool only for low-level debugging; prefer `computer_use` for general safe inspected GUI flows. Use CDP/Playwright only when the task specifically needs browser protocol access.

```typescript
cua_driver({ action: "status" })
cua_driver({ action: "permissions" })
cua_driver({ action: "list_windows", args: { on_screen_only: true } })
cua_driver({ action: "capture", args: { pid: 12345, window_id: 67890 } })
cua_driver({ action: "click", args: { pid: 12345, window_id: 67890, element_index: 7 } })
```

The tool intentionally does not expose CuaDriver foreground/destructive helpers such as `bring_to_front` or `kill_app`.

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
llm_frontend_browser({ action: "prompt", provider: "grok", prompt: "Search public X posts from @openai about Codex and summarize them", waitForResponse: false })
llm_frontend_browser({ action: "open", provider: "deepseek", background: true })
llm_frontend_browser({ action: "open", provider: "grok", background: true })
llm_frontend_browser({ action: "open", provider: "jimeng", background: true })
llm_frontend_browser({ action: "status", provider: "chatgpt" })
```

`action: "setup"`/`"open"`/`"status"` support AI Studio, DeepSeek, ChatGPT, Grok, and Jimeng profiles. `action: "prompt"` currently supports AI Studio, ChatGPT, and Grok. `action: "collect"`/`"wait"` currently supports ChatGPT and best-effort Grok conversations. It will not accept terms of service, solve CAPTCHA, or bypass account challenges; those states return `needsHuman: true`.

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
pi-llm-browser open --provider grok --background
pi-llm-browser open --provider jimeng --background
pi-llm-browser status --provider chatgpt
```

## How it works

```
web_search → Kagi SSE (Firefox cookies) → Gemini API (grounding)
fetch_content → HTTP + Readability → Jina Reader → background Chrome capture (macOS) → Gemini API → Gemini Web
youtube_transcript → yt-dlp (metadata + auto-generated captions)
chrome_cookies → macOS Keychain (Chrome SQLite) → Chrome DevTools CDP
chatgpt_handoff → pbcopy → open ChatGPT in Firefox for manual submission
computer_use → policy check & layout freshness validation → CuaDriver execution
cua_driver → CuaDriver CLI/MCP tools → background macOS window capture/actions
codex_session / /codex-resume → ~/.codex/sessions JSONL → hidden Pi context + resume prompt
/agent-history → history:// registry protocol → read-only live/parked subagent transcript
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

`fetch_content` browser fallback knobs:

- `PI_FETCH_BROWSER_APP` — macOS browser app name to use for background extraction (default tries `Google Chrome`, then Chromium/Brave/Edge)
- `PI_DISABLE_BROWSER_FALLBACK=1` — disable the background browser fallback entirely

## Testing

```bash
bun run typecheck                 # from repo root
bun run test                      # from repo root; 33 tests
bun run web-access:smoke          # live tool check
pi -e ./packages/web-access/src/index.ts --help
```

## Requirements

- macOS for zero-config cookie access (Linux works with `--remote-debugging-port=9222`)
- `yt-dlp` for YouTube transcripts (`brew install yt-dlp`)
- Kagi account (signed into Firefox or Chrome)
