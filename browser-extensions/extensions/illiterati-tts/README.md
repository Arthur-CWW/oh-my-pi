# Illiterati Browser Extension Prototype (Bun + Vite + SolidJS)

Quick Chrome MV3 prototype for the architecture in `/docs/browser_extension_architecture.md`.

## What this prototype does
- Injects a small page overlay with a `Read selection` button.
- Uses `content -> background -> offscreen` messaging.
- Offscreen runtime simulates model loading and streams mock PCM chunks + alignment tuples.
- Verifies model artifact checksums and caches shard files in OPFS for reload persistence.
- Content script plays streamed chunks using Web Audio.
- Renders popup UI using SolidJS.
- Adds a Settings page (`chrome-extension://<id>/settings.html`) with sample Chinese text and direct test generation.

## Run
```bash
pnpm install
pnpm --filter illiterati-tts dev
```

This writes built files to `extensions/illiterati-tts/dist/` continuously.

## Load in Chrome
1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click `Load unpacked` and select `extensions/illiterati-tts/dist`.
4. Open any webpage, select text, and click `Read selection` in the floating overlay.
5. Open extension details and click `Extension options` for `settings.html`.

## Manual E2E test (current branch)
From repo root:
```bash
pnpm install
pnpm --filter illiterati-tts dev
```

Then in Chrome:
1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click `Load unpacked` and choose `extension/dist`.
4. Open `https://example.com/` (or any normal page).
5. Select a paragraph of text.
6. Click `Read selection` in the page overlay.
7. Confirm you hear audio and status moves through `queued/loading/generating` to `Done (...)`.

Where to verify:
- Page DevTools console: `tts.progress`, `tts.stream`, `tts.done` logs from content.
- Extension service worker logs: `tts.stream` relays and `tts.done` with a `clipId`.
- Popup (`popup.html`): click `Refresh Clips` and verify at least one row is listed.
- Settings page (`settings.html`): includes built-in log viewer and sample text test controls.

## If `pnpm --filter illiterati-tts dev` is running but you see no logs
- Content/page logs: open DevTools on the target webpage and check Console.
- Background logs: `chrome://extensions` -> Illiterati -> `service worker` link.
- Popup logs: open popup, right-click, `Inspect`.
- Settings logs: open `settings.html` and use `Refresh Logs`.

The dev watcher only rebuilds `dist/`; Chrome won’t auto-refresh the extension. After changes:
1. Open `chrome://extensions`
2. Click `Reload` on Illiterati extension
3. Retry on a normal page (not browser internal pages)

## How to tell mock audio vs real model audio
Current state on this branch is still mock synthesis:
- `src/offscreen/main.ts` uses `runMockTts` and `mockPcmChunk`.
- `public/model/qwen3-tts-0.6b/model.index.json` is marked `mock-shard-index`.

So E2E currently validates transport, playback, cache plumbing, and persistence. It does not validate real Qwen inference quality yet.

## Current limitations
- TTS/audio is mocked (sine-wave chunks), no model integration yet.
- Bundled placeholder shards are used for cache plumbing, not real model weights.
- No side panel UI yet.

## Debug logs in Chrome
- Content script logs: open page DevTools on the tab where overlay runs.
- Background service worker logs: `chrome://extensions` -> extension card -> `service worker` link.
- Offscreen logs: open extension service worker logs first, then trigger synthesis to see relay events.
- Popup logs: right-click popup -> `Inspect`.
- All logs are prefixed with `[illiterati]`.

## Automated smoke test
Run this from the monorepo root:
```bash
pnpm smoke:illiterati-tts
```
What it does:
- Builds the extension.
- Launches Chromium with unpacked extension loaded.
- Opens popup and clicks `Warmup Runtime`.
- Opens `https://example.com`, selects paragraph text, clicks overlay `Read selection`.
- Records console logs and writes them to `.logs/smoke-<timestamp>.log`.

## Automated E2E test (text -> audio pipeline)
Run this from the monorepo root:
```bash
pnpm --filter illiterati-tts e2e
```
What it asserts:
- Popup warmup triggers synthesis end-to-end.
- Service worker relays `tts.stream` events with non-zero `pcmLength`.
- Service worker relays `tts.done`.
- Popup clip table shows a persisted clip row.
- Also attempts overlay click on a real page and logs whether it was detected in that run.
- Clears local SQLite clip store at run start so each run starts clean.

Log file output:
- `.logs/e2e-<timestamp>.log`
- Playwright screenshots in `output/playwright/`

## Long-running watch + Playwright E2E
Terminal 1:
```bash
pnpm --filter illiterati-tts dev
```

Terminal 2:
```bash
pnpm --filter illiterati-tts e2e:dist
```
Use `e2e:dist` when `dev` is already watching; it reuses current `dist/` and still saves logs/artifacts.
