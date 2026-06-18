# Illiterati Browser Extension Prototype (Bun + Vite + SolidJS)

Quick Chrome MV3 prototype for the architecture in `/docs/browser_extension_architecture.md`.

## What this prototype does
- Injects a small page overlay with a `Read selection` button.
- Uses `content -> background -> offscreen` messaging.
- Offscreen runtime simulates model loading and streams mock PCM chunks + alignment tuples.
- Verifies model artifact checksums and caches shard files in OPFS for reload persistence.
- Content script plays streamed chunks using Web Audio.
- Renders popup UI using SolidJS.

## Run
```bash
pnpm install
pnpm --filter illiterati-tts-opfs-parallel dev
```

This writes built files to `extensions/illiterati-tts-opfs-parallel/dist/` continuously.

## Load in Chrome
1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click `Load unpacked` and select `extensions/illiterati-tts-opfs-parallel/dist`.
4. Open any webpage, select text, and click `Read selection` in the floating overlay.

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
pnpm smoke:illiterati-tts-opfs-parallel
```
What it does:
- Builds the extension.
- Launches Chromium with unpacked extension loaded.
- Opens popup and clicks `Warmup Runtime`.
- Opens `https://example.com`, selects paragraph text, clicks overlay `Read selection`.
- Records console logs and writes them to `.logs/smoke-<timestamp>.log`.
