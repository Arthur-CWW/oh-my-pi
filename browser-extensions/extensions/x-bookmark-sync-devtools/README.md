# X Bookmark Sync DevTools

Chrome/Helium DevTools extension for capturing X/Twitter bookmark-related GraphQL/API responses for local sync experiments.

The extension UI is built with **SolidJS + Tailwind CSS v4 + Vite**. It is an extension-owned DevTools page, so the UI stack is isolated from the inspected website and is not injected into X/Twitter.

## Build

```bash
cd /Users/arthur/projects/browser-extensions
pnpm --filter x-bookmark-sync-devtools build
```

## Load unpacked

1. Build the extension.
2. Open `chrome://extensions` in Chrome/Helium.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the built output folder:

```text
/Users/arthur/projects/browser-extensions/extensions/x-bookmark-sync-devtools/dist
```

Then open DevTools on X/Twitter and select the **X Bookmarks** panel.

## Launch Helium with the extension

```bash
cd /Users/arthur/projects/browser-extensions
pnpm launch:helium:x-bookmarks
```

This builds the extension, uses a dedicated profile at `~/.helium-x-bookmark-sync`, and opens `https://x.com/i/bookmarks` with DevTools auto-opened.

## Development

```bash
pnpm --filter x-bookmark-sync-devtools dev
```

This runs `vite build --watch`. After changes, reload the extension on `chrome://extensions` and reopen/reload DevTools.

## How it works

- Uses `chrome.devtools.network.onRequestFinished`.
- Calls `request.getContent()` to read response bodies captured by DevTools.
- Filters to X/Twitter URLs and bookmark-ish GraphQL/API responses.
- Shows captured requests and tweet-like records in a custom DevTools panel.
- Can download a JSON snapshot or POST it to a local endpoint.

Default local ingest endpoint:

```text
http://127.0.0.1:51747/x-bookmark-sync/ingest
```

## Limitations

- Captures only while DevTools and this panel are open.
- It cannot add UI inside Chrome's built-in Network panel.
- It does not modify requests/responses.
- It is meant for your own account/local data experiments. Avoid storing cookies, CSRF tokens, or bearer tokens.

## Validate/package

```bash
pnpm check
pnpm zip:x-bookmark-sync-devtools
```
