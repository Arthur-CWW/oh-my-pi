# Browser Extensions Monorepo

Personal monorepo for browser extension experiments and agent-facing browser/API tooling.

Inspired by the broad shape of larger TS monorepos: independent packages, repo-level scripts, shared internal libraries, and docs for operational patterns.

## Layout

```text
extensions/            Browser extensions, one package per extension
packages/              Shared TS libraries and build tooling
skills/                Agent skills with TypeScript helpers
tools/                 Local daemons/CLIs used by agents or native/browser bridges
reveng/   Unpacked extension case studies and source snapshots
scripts/               Repo-level checks/smoke helpers
docs/                  Architecture notes and how-tos
```

## Current extensions

- [`extensions/x-bookmark-sync-devtools`](extensions/x-bookmark-sync-devtools) — SolidJS + Tailwind DevTools panel for dedicated Chrome/Chromium/Helium capture of X/Twitter bookmark-related GraphQL/API responses.
- [`extensions/dev-browser`](extensions/dev-browser) — WXT extension for connecting a browser session to the dev-browser skill.
- [`extensions/illiterati-tts`](extensions/illiterati-tts) — Vite + SolidJS MV3 offline TTS/alignment prototype.
- [`extensions/illiterati-tts-opfs-parallel`](extensions/illiterati-tts-opfs-parallel) — parallel OPFS branch variant of the Illiterati TTS prototype.
- [`extensions/youtube-stats-overlay`](extensions/youtube-stats-overlay) — clean-room YouTube stats overlay prototype with vidIQ-inspired dummy UI.

## Authenticated X/Twitter capture direction

- Preferred next path: a Firefox WebExtension for authenticated read-only capture and future browser-control/RPC work. In normal Firefox, develop with temporary unsigned install through `about:debugging#/runtime/this-firefox`; it must be reloaded after browser restart unless you move to a signed or policy-managed distribution.
- Fallback extractor: a Violentmonkey userscript on authenticated `x.com`/`twitter.com` pages, using the same localhost health ping and lightweight `pageUrl`/`visibleTweets` ingest shape as the archive server.
- Still-valid specialized lane: [`extensions/x-bookmark-sync-devtools`](extensions/x-bookmark-sync-devtools) for dedicated Chrome/Chromium/Helium profiles where DevTools network capture is the goal.
- Eventual control stack: browser extension in the logged-in browser, localhost daemon/server for normalization and persistence, and an optional debugger/native bridge when extension DOM capture alone is insufficient.

## Shared packages

- [`packages/capture-schema`](packages/capture-schema) — shared capture/replay TypeScript types.

## Skills

- [`skills/dev-browser`](skills/dev-browser) — persistent browser automation skill and relay server.
- [`skills/chrome-extension-reveng`](skills/chrome-extension-reveng) — workflow and TypeScript analyzer for unpacked Chrome extension reveng.

## Tools

- [`tools/agent-bridge`](tools/agent-bridge) — placeholder for a local agent bridge daemon.
- [`tools/vidiq-proxy`](tools/vidiq-proxy) — cache/replay proxy for exploring vidIQ request shapes.
- [`tools/vidiq-dom-capture`](tools/vidiq-dom-capture) — CDP helper for snapshotting vidIQ-injected DOM from a live YouTube tab.

## Reverse engineering

- [`reveng/vidiq-vision`](reveng/vidiq-vision) — local installed snapshot of vidIQ Vision for YouTube, Chrome Web Store ID `pachckjkecffpdphbpmfolblodfkgbhl`.

## Commands

```bash
pnpm build
pnpm typecheck
pnpm check
pnpm test
pnpm build:dev-browser
pnpm build:illiterati-tts
pnpm build:illiterati-tts-opfs-parallel
pnpm build:youtube-stats-overlay
pnpm zip:x-bookmark-sync-devtools
pnpm zip:dev-browser
pnpm smoke:illiterati-tts
pnpm smoke:illiterati-tts-opfs-parallel
pnpm launch:helium:x-bookmarks
pnpm skill:reverse-engineer
pnpm proxy:vidiq
pnpm capture:vidiq-dom
```

## Loading an unpacked extension

Build first, then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the built extension folder, for example:

```bash
pnpm --filter x-bookmark-sync-devtools build
```

```text
/Users/arthur/projects/browser-extensions/extensions/x-bookmark-sync-devtools/dist
```

For WXT extensions, load their `.output/<browser>-mv3` build output after running the relevant build command.

For Vite extensions, load the `dist/` folder under that extension package.

## Imported sources

This repo now consolidates source from:

- `/Users/arthur/projects/dev-browser/extension` -> `extensions/dev-browser`
- `/Users/arthur/projects/dev-browser/skills/dev-browser` -> `skills/dev-browser`
- `/Users/arthur/projects/illiterati/extension` -> `extensions/illiterati-tts`
- `/Users/arthur/projects/illiterati-thread-b-parallel/extension` -> `extensions/illiterati-tts-opfs-parallel`
- `/Users/arthur/Library/Application Support/Google/Chrome/Default/Extensions/pachckjkecffpdphbpmfolblodfkgbhl/3.196.2_0` -> `reveng/vidiq-vision`

## Direction

The long-term target is a general API reveng/proxying toolkit for LLM agents:

- capture internal API traffic from existing logged-in browsers,
- keep browser automation in the background,
- reconstruct replayable request recipes,
- avoid Puppeteer/Playwright in the final agent-facing path,
- use raw CDP/BiDi and browser-extension APIs where possible.

See [`docs/architecture.md`](docs/architecture.md) and [`docs/background-browser-automation.md`](docs/background-browser-automation.md).
