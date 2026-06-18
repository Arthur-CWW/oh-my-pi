# Twitter Archive Firefox

Firefox Manifest V2 WebExtension for read-only authenticated X/Twitter capture. It reads visible tweet cards from the active page and posts them to the local `twitter-archive` ingest endpoint.

## What it does

- toolbar button: sync visible tweet cards from the active `x.com` or `twitter.com` tab
- background sync: every 60 seconds the background script checks all open `x.com`/`twitter.com` tabs and posts bounded visible tweet/signal snapshots to localhost
- tab-load sync: when an X/Twitter tab completes navigation, the background script captures that tab once
- browser-action context menu: **Sync visible tweets** and **Ping localhost health**
- keyboard shortcuts:
  - `Alt+Shift+S` → sync visible tweets via `_execute_browser_action`
  - `Alt+Shift+H` → ping `http://127.0.0.1:3420/api/health`
- localhost ingest target: `http://127.0.0.1:3420/api/x-bookmark-sync/ingest`
- payload shape mirrors the existing lightweight userscript lane: visible tweet cards plus normalized `tweetLike` records inside a single capture snapshot, with lightweight read-only interaction signals

## Signals

The content script captures local, read-only observations while you browse X/Twitter:

- `page_load` — content script injected on a supported X/Twitter page
- `url_change` — SPA navigation detected via wrapped `history.pushState`/`replaceState`, `popstate`, `hashchange`, and a 1-second `location.href` poll fallback
- `tab_visible` / `tab_hidden` — `document.visibilitychange` events
- `tweet_visible` — a tweet card enters the viewport (IntersectionObserver)
- `tweet_dwell` — a tweet card was visible for at least 500 ms and then left the viewport
- `control_click` — click on a known control such as like/unlike, bookmark/removeBookmark, reply, retweet, share, or caret (`data-testid` match); uses a single capturing passive document listener
- `thread_expand` — click on a tweet card that has an identifiable status link
- `profile_visit` — navigation lands on a `/handle` profile page

Each signal carries:

- `signalId` — client-generated idempotent id for server-side upsert/ignore
- `kind`, `observedAt` ISO timestamp, `pageUrl`
- optional `durationMs`, `sourceUrl`, `tabId`, `sessionId`
- optional `tweetId`, `profileHandle`, `listId`, `searchQuery`
- optional `confidence` (0–1) and `details` object

Signals are kept in a bounded in-memory buffer (latest 2000). The buffer is sent when you press `Alt+Shift+S`, click the toolbar button, choose **Sync visible tweets**, complete navigation in an X/Twitter tab, or during the 60-second background all-X-tabs pass. After the local server accepts a sync, the background script acknowledges the sent `signalId`s so the content script removes them from the pending buffer; failed POSTs keep the signals for retry. If no visible tweet cards parse but recent signals exist, the snapshot is still sent.

## Future work

- Browser-local persistence: today signals live in the content script's bounded pending buffer. A future iteration should store them in IndexedDB or a local SQLite database in the extension and sync batches to the server in the background, with the same idempotent `signalId` upsert behavior.

## Build

```bash
cd /Users/arthur/agents/browser-extensions/extensions/twitter-archive-firefox
bun run build
```

The unpacked temporary-install artifact is written to:

```text
/Users/arthur/agents/browser-extensions/extensions/twitter-archive-firefox/dist
```

Load `dist/manifest.json` directly in Firefox, or point `web-ext` at the `dist` directory.

## Run with the dedicated helper

```bash
cd /Users/arthur/agents/browser-extensions/extensions/twitter-archive-firefox
bun run run:firefox
```

This command builds first, then runs `web-ext` against the built artifact.

From the parent workspace root you can run the same flow with one command:

```bash
cd /Users/arthur/agents/browser-extensions
bun run run:twitter-archive-firefox
```

Profile behavior:

- by default the runner points `web-ext` at `~/.twitter-archive-firefox` and lets `web-ext` create that dedicated profile directory if missing
- set `TWITTER_ARCHIVE_FIREFOX_PROFILE=/custom/profile/path` if you want a different dedicated profile directory
- use `--profile /path/to/profile` or `FIREFOX_PROFILE=/path/to/profile` only when you explicitly want to opt into an existing signed-in Firefox profile

Examples:

```bash
FIREFOX_PROFILE="$HOME/Library/Application Support/Firefox/Profiles/your-profile.default-release" bun run run:firefox
TWITTER_ARCHIVE_FIREFOX_PROFILE=~/.twitter-archive-firefox-work bun run run:firefox
```
The runner keeps the dedicated Firefox profile, authenticated session, and extension settings across runs, but that `web-ext` profile is intentionally unsafe for daily browsing use and the extension itself is still a temporary unsigned install.

## Temporary install in Firefox

You do not need a signed XPI for development.

1. Start the local archive server on `http://127.0.0.1:3420`.
2. Build the extension.
3. Open `about:debugging#/runtime/this-firefox`.
4. Click **Load Temporary Add-on…**.
5. Select `dist/manifest.json` from this package.
6. Open an authenticated X/Twitter page such as:
   - `https://x.com/i/bookmarks`
   - a public status/thread page
   - a search page
   - a profile page you are already allowed to view
7. Click the extension toolbar button, use the browser-action menu, or use the keyboard shortcuts.

Permanent unsigned install is not guaranteed on release Firefox builds. Treat this as a temporary developer workflow unless you sign/package it through the normal Firefox add-on process.

## Data captured

Each sync reads only visible tweet cards from the current page and sends:

- status URL
- tweet id
- username
- tweet text
- media URLs visible in the card
- reply context such as `Replying to @user`
- quoted-status URL when visible
- page metadata (`pageUrl`, `pageTitle`, `pageKind`)

The background script wraps that DOM capture into the existing `x-bookmark-sync` snapshot envelope before POSTing to localhost, including any recent interaction signals captured by the content script.

## Safety and limitations

- Read-only: no posting, liking, bookmarking, following, replaying private APIs, or mutating X/Twitter.
- No cookie/token extraction and no private API requests.
- DOM-only capture: it archives only tweet cards currently visible on the page.
- Capture is blocked on messages, notifications, topics, settings, and compose pages.
- Do not use this on protected/private-account pages.
- Localhost only by default; no remote exfiltration path is configured.
- Because this is a temporary unsigned extension workflow, reload/reinstall may be required after rebuilds or Firefox restarts.
