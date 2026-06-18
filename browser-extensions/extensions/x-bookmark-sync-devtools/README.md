# X Bookmark Sync DevTools

Chrome/Chromium/Helium DevTools extension for capturing X/Twitter bookmark-related GraphQL/API responses and sending them to the local `twitter-archive` dev server.

The extension UI is built with **SolidJS + Tailwind CSS v4 + Vite**. It is an extension-owned DevTools page, so the UI stack is isolated from the inspected website and is not injected into X/Twitter.

## Build

```bash
cd /Users/arthur/agents/browser-extensions
pnpm --filter x-bookmark-sync-devtools build
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
cd /Users/arthur/agents/browser-extensions
pnpm --filter x-bookmark-sync-devtools launch:chrome
```

This builds first, then launches Chrome/Chromium with:

- `--load-extension=extensions/x-bookmark-sync-devtools/dist`
- `--user-data-dir=~/.chrome-x-bookmark-sync`
- `--auto-open-devtools-for-tabs`
- default URL `https://x.com/i/bookmarks`

It does not force-close or reuse your normal Chrome profile. Override the browser/profile when needed:

```bash
CHROME_APP="Chromium" pnpm --filter x-bookmark-sync-devtools launch:chrome
CHROME_BIN=/path/to/chrome CHROME_PROFILE=~/.x-bookmark-sync-chrome pnpm --filter x-bookmark-sync-devtools launch:chrome
bash extensions/x-bookmark-sync-devtools/scripts/launch-chrome.sh https://x.com/i/bookmarks
```

## Helium launch helper

```bash
cd /Users/arthur/agents/browser-extensions
pnpm --filter x-bookmark-sync-devtools launch:helium
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
pnpm --filter x-bookmark-sync-devtools dev
```

This runs `vite build --watch`. After changes, reload the extension on `chrome://extensions` and reopen/reload DevTools.

## Validate/package

```bash
pnpm --filter x-bookmark-sync-devtools check
pnpm --filter x-bookmark-sync-devtools zip
```
