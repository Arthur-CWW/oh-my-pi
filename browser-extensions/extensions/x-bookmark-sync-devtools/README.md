# X Bookmark Sync DevTools

Chrome/Chromium/Helium DevTools extension for capturing X/Twitter bookmark-related GraphQL/API responses and sending them to the local `twitter-archive` dev server. It remains a valid dedicated-profile DevTools capture lane, but the recommended general authenticated path is the Firefox WebExtension, with the userscript kept as fallback.

The extension UI is built with **SolidJS + Tailwind CSS v4 + Vite**. It is an extension-owned DevTools page, so the UI stack is isolated from the inspected website and is not injected into X/Twitter.

## Build

```bash
cd /Users/arthur/agents/browser-extensions/extensions/x-bookmark-sync-devtools
bun run build
```

The built unpacked extension is:

```text
/Users/arthur/agents/browser-extensions/extensions/x-bookmark-sync-devtools/dist
```

## Load unpacked

1. Start the local `twitter-archive` dev server; the extension posts to `http://127.0.0.1:3420/x-bookmark-sync/ingest` by default.
2. Build the extension.
3. Open `chrome://extensions` in Chrome, Chromium, or Helium.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the built `dist` folder shown above.
7. Open `https://x.com/i/bookmarks`, open DevTools, then select the **X Bookmarks** panel.
8. Scroll the bookmarks timeline. The panel captures bookmark-related network responses visible to DevTools and can **Post to archive** or **Download JSON**.

## Dedicated Chrome/Chromium launch helper

```bash
cd /Users/arthur/agents/browser-extensions/extensions/x-bookmark-sync-devtools
bun run launch:chrome
```

This builds first, then launches Chrome/Chromium with:

- `--load-extension=extensions/x-bookmark-sync-devtools/dist`
- `--user-data-dir=~/.chrome-x-bookmark-sync`
- `--auto-open-devtools-for-tabs`
- default URL `https://x.com/i/bookmarks`

It does not force-close or reuse your normal Chrome profile. Override the browser/profile when needed:

```bash
CHROME_APP="Chromium" bun run launch:chrome
CHROME_BIN=/path/to/chrome CHROME_PROFILE=~/.x-bookmark-sync-chrome bun run launch:chrome
bash scripts/launch-chrome.sh https://x.com/i/bookmarks
```

## Dedicated Chrome dev loop

```bash
cd /Users/arthur/agents/browser-extensions/extensions/x-bookmark-sync-devtools
bun run launch:chrome:dev
```

This starts `vite build --watch`, waits for `dist/manifest.json`, then launches the same dedicated Chrome profile with the unpacked extension loaded.

Reload behavior:

- panel CSS/JS changes: reopen/reload the **X Bookmarks** DevTools panel.
- manifest/background/service-worker changes: click **Reload** for the extension on `chrome://extensions`.
- inspected X page state/logins stay in `~/.chrome-x-bookmark-sync`.

CMUX built-in browser note: the controlled CMUX browser is WebKit/Safari-like and does not expose `chrome.runtime` or `chrome://extensions`, so Chrome extensions cannot be loaded there. Use this dedicated Chrome dev loop for extension work.

## Recommended authenticated capture hierarchy

### 1. Firefox WebExtension preferred

- Preferred next path for authenticated X/Twitter capture and future browser-control/RPC evolution.
- Firefox content script plus background script can reuse the archive server's lightweight visible-page ingest shape (`pageUrl` + `visibleTweets`) while adding host permissions, extension storage/alarms, browser actions/commands, and localhost RPC.
- In normal Firefox, use temporary unsigned install via `about:debugging#/runtime/this-firefox`. It disappears on browser restart; persistent unsigned install generally needs a signed build or a policy-managed Developer/Nightly/ESR setup.

### 2. Violentmonkey userscript fallback

If the Firefox WebExtension is not available yet or install friction blocks progress, use the userscript instead:

```text
/Users/arthur/agents/browser-extensions/extensions/x-bookmark-sync-devtools/twitter-archive-sync.user.js
```

Recommended setup:

1. Keep the local archive server running at `http://127.0.0.1:3420`.
2. In Firefox, install/enable **Violentmonkey**.
3. Create/import the userscript file above.
4. Open an authenticated `x.com` page such as:
   - `https://x.com/i/bookmarks`
   - a profile page
   - a search/list page
5. Use the Violentmonkey menu commands:
   - **Twitter archive: ping localhost health**
   - **Twitter archive: sync visible tweets**

What it does:

- reads visible tweet cards from the current authenticated page DOM
- sends normalized tweet/status records to `POST /x-bookmark-sync/ingest`
- lets the local server write SQLite rows, archive jobs, and Markdown

This is the manual fallback extractor, not the long-term RPC surface.

### 3. This Chrome DevTools extension remains valid

- Use it when you want dedicated Chrome/Chromium/Helium profile capture or DevTools-first network inspection of bookmark responses.
- It observes network responses rather than visible DOM, so it remains useful for bookmark/network debugging even though the Firefox WebExtension is the preferred general authenticated path.

## API surface summary

| Path | Browser surface | Local API shape |
|---|---|---|
| Firefox WebExtension | Visible DOM via content script plus background messaging, host permissions, storage, and alarms. | `GET /api/health` plus `POST /x-bookmark-sync/ingest` with userscript-compatible `pageUrl` and `visibleTweets` payloads first, then richer extension RPC or optional native messaging later if needed. |
| Violentmonkey userscript | Visible DOM on the current authenticated page only. | Same page-context `GET /api/health` ping and lightweight `POST /x-bookmark-sync/ingest` payload. |
| Chrome DevTools extension | Observed network responses via DevTools APIs. | `POST /x-bookmark-sync/ingest` with response snapshots and derived tweet-like records. |

## Eventual control stack

- extension inside the logged-in browser for host-permission DOM capture, background commands, and user-invoked actions
- localhost `twitter-archive` server/daemon for normalization, persistence, queueing, and reviewer-visible RPC
- optional debugger/native bridge only when extension-visible DOM capture is insufficient, never for credential extraction or private API replay

## Helium launch helper

```bash
cd /Users/arthur/agents/browser-extensions/extensions/x-bookmark-sync-devtools
bun run launch:helium
```

This keeps the existing Helium flow working: it builds first, uses a dedicated profile at `~/.helium-x-bookmark-sync`, loads `dist`, and opens `https://x.com/i/bookmarks` with DevTools auto-opened.

## Local archive endpoint

Default local ingest endpoint:

```text
http://127.0.0.1:3420/x-bookmark-sync/ingest
```

The endpoint can be changed in the panel. The default is the running `twitter-archive` dev server, which owns SQLite/JSONL persistence and Markdown export. Markdown output defaults on the server side to `data/twitter-archive/markdown/bookmarks`; configure the archive server separately if you want an Obsidian vault path.

## How it works

- Uses `chrome.devtools.network.onRequestFinished`.
- Calls `request.getContent()` to read response bodies captured by DevTools.
- Drops sensitive response headers such as `set-cookie`, `cookie`, `authorization`, and `x-csrf-token` from saved snapshots.
- Filters to X/Twitter URLs and bookmark-ish GraphQL/API responses.
- Shows captured requests and tweet-like records in a custom DevTools panel.
- Can download a JSON snapshot or POST captured data to the local archive server.

## Safety and limitations

- Read-only: it observes DevTools network responses and does not mutate X/Twitter, replay private APIs, click buttons, or modify requests/responses.
- Captures only while DevTools and the **X Bookmarks** panel are open.
- Captures only responses visible from the active logged-in browser session while you browse/scroll `x.com/i/bookmarks`.
- Posts captured response data only to the configured local endpoint; the default is localhost.
- It cannot add UI inside Chrome's built-in Network panel.
- It is meant for your own account/local archive. Avoid storing cookies, CSRF tokens, bearer tokens, or unrelated private data.

## Development

```bash
bun run dev
```

This runs `vite build --watch`. After changes, reload the extension on `chrome://extensions` and reopen/reload DevTools.

## Validate/package

```bash
bun run check
bun run zip
```
