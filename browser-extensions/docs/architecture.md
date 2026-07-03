# Architecture

This repo is shaped like a small monorepo: independent browser extensions plus shared packages and local agent tools.

## Directory shape

```text
browser-extensions/
  extensions/
    x-bookmark-sync-devtools/   First DevTools capture prototype
    api-lens/                   Future general API reveng extension
  packages/
    capture-schema/             Shared capture/replay data types
    browser-control/            Future CDP/BiDi attach helpers
    api-replay/                 Future request recipe builder/replayer
  tools/
    agent-bridge/               Future local daemon for Pi/LLM agents
  scripts/                      Repo-level checks and smoke tests
  docs/                         Notes and operating procedures
```

## Long-term product shape

The useful target is not a single DevTools panel. It is a local agent-facing API reveng system:

1. **Browser extension capture layer**
   - Observe request URLs, headers, request bodies, response bodies where available.
   - For Chrome/Helium, use DevTools APIs, `chrome.debugger`, or page-world hooks depending on mode.
   - For Firefox, use WebExtensions APIs and response stream filtering where available.

2. **Local bridge layer**
   - Runs on localhost.
   - Receives captures from extensions.
   - Stores sessions in SQLite/JSONL.
   - Exposes a small HTTP/WebSocket API to Pi/LLM agents.

3. **Replay/reconstruction layer**
   - Converts captures into replayable request recipes.
   - Redacts cookies/tokens by default.
   - Allows agents to reissue selected internal API calls without Puppeteer/Playwright.
   - Tracks required headers, query params, body shape, cursors, and auth dependencies.

4. **Background browser control layer**
   - Attaches to existing Chrome/Helium via CDP or Firefox via BiDi/native debugging.
   - Reuses existing logged-in tabs/profiles.
   - Avoids stealing focus.
   - Falls back to a quarantined automation workspace if a visible window is unavoidable.

## Capture modes

| Mode | Browser | Background friendly | Reads response bodies | Detectability | Notes |
| --- | --- | ---: | ---: | ---: | --- |
| DevTools panel | Chrome/Helium/Firefox | No | Yes, while DevTools is open | Low | Good for exploration, bad for always-on sync. |
| `chrome.debugger`/CDP extension | Chrome/Helium | Yes-ish | Often | Low website-side, visible browser-side | Powerful but scary permission. |
| Main-world fetch/XHR hook | Chrome/Firefox | Yes | Fetch/XHR only | Medium | Requestly-style. Detectable by page JS. |
| Firefox response stream | Firefox | Yes | Yes | Low | Best extension-native path for body capture. |
| Local MITM proxy | Any | Yes | Yes | Medium/high | Most complete, but TLS/proxy setup and fingerprints matter. |

## Recommended next extension

Create `extensions/api-lens` as the general tool rather than making the X bookmark prototype too broad.

Suggested modes:

- `passive-devtools`: custom DevTools panel for interactive reveng.
- `debugger-capture`: Chrome/Helium background-ish capture using `chrome.debugger`.
- `page-hook`: optional Requestly-style fetch/XHR hook.
- `firefox-stream`: Firefox build using response stream filtering.

All modes should emit the shared `Capture` shape from `packages/capture-schema`.
