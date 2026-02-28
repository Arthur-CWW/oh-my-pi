# Playwright vs Puppeteer for Electron (Evidence Report)

_Last updated: 2026-02-26_

This report extends the prior native-agent docs (`docs/native-agent-*`) with a focused, source-backed comparison for **Electron app automation** and a snapshot of recent issue activity.

---

## Executive summary

- **Most officially supported for Electron app automation:** **Playwright** (it has a first-party Electron API surface), but Playwright still labels Electron support as **experimental**.
- **Puppeteer** does **not** provide a first-party Electron automation API in the same way; in core types it only declares `'chrome' | 'firefox'` as supported browsers.
- For Puppeteer+Electron workflows, official docs/code steer you toward custom-provider/extensibility paths and explicitly warn these are **not officially supported**.
- Maintenance ownership differs:
  - Playwright package metadata: **Microsoft Corporation**.
  - Puppeteer package metadata: **The Chromium Authors** (repo under `puppeteer/puppeteer`).

---

## What “officially supported” looks like in each project

### Playwright

Evidence:

1. Playwright has a dedicated Electron API class doc and explicitly says Electron automation exists (but is experimental):
   - `docs/src/api/class-electron.md` (`experimental` wording)
   - Permalink: https://github.com/microsoft/playwright/blob/4ce4c97a04259219935ecef79181350b1ae6243a/docs/src/api/class-electron.md#L1-L6

2. Playwright has concrete Electron client implementation classes (`Electron`, `ElectronApplication`) in core:
   - `packages/playwright-core/src/client/electron.ts`
   - Permalink: https://github.com/microsoft/playwright/blob/4ce4c97a04259219935ecef79181350b1ae6243a/packages/playwright-core/src/client/electron.ts#L47-L170

3. Playwright repo includes dedicated Electron test config + scripts:
   - Root script `etest` points to `tests/electron/playwright.config.ts`
   - Permalinks:
     - https://github.com/microsoft/playwright/blob/4ce4c97a04259219935ecef79181350b1ae6243a/package.json#L23
     - https://github.com/microsoft/playwright/blob/4ce4c97a04259219935ecef79181350b1ae6243a/tests/electron/playwright.config.ts#L53-L80

Interpretation: Electron is **first-party surface area** in Playwright, but still marked **experimental**.

### Puppeteer

Evidence:

1. Puppeteer’s own “what is Puppeteer” doc describes browser control as Chrome/Firefox (no first-party Electron API described):
   - https://github.com/puppeteer/puppeteer/blob/98dd158c404d0fb844657bab7b55e502ff5088ef/docs/guides/what-is-puppeteer.md#L1-L7

2. Puppeteer core supported browser type is only `'chrome' | 'firefox'`:
   - https://github.com/puppeteer/puppeteer/blob/98dd158c404d0fb844657bab7b55e502ff5088ef/packages/puppeteer-core/src/common/SupportedBrowser.ts#L7-L12

3. Extensibility code/docs discuss Electron-style custom provider examples but explicitly warn custom providers are **not officially supported** and default compatibility guarantees are only for default binaries:
   - https://github.com/puppeteer/puppeteer/blob/98dd158c404d0fb844657bab7b55e502ff5088ef/packages/browsers/src/provider.ts#L18-L55
   - https://github.com/puppeteer/puppeteer/blob/98dd158c404d0fb844657bab7b55e502ff5088ef/packages/browsers/src/install.ts#L125-L152

4. Long-running open issue asking for Electron support remains open:
   - `Support Electron and other content embedders` (#4283, opened 2019-04-13, still open)
   - https://github.com/puppeteer/puppeteer/issues/4283

Interpretation: Puppeteer can be made to work in Electron-adjacent setups, but Electron is **not a first-class officially guaranteed target** like Chrome/Firefox.

---

## Who maintains each project?

- **Playwright**
  - Repo owner: `microsoft/playwright`
  - Package metadata author: `Microsoft Corporation`
  - Evidence:
    - https://github.com/microsoft/playwright/blob/4ce4c97a04259219935ecef79181350b1ae6243a/package.json#L14-L16

- **Puppeteer**
  - Repo owner: `puppeteer/puppeteer` (Puppeteer org)
  - Package metadata author: `The Chromium Authors`
  - Evidence:
    - https://github.com/puppeteer/puppeteer/blob/98dd158c404d0fb844657bab7b55e502ff5088ef/packages/puppeteer/package.json#L4
    - https://github.com/puppeteer/puppeteer/blob/98dd158c404d0fb844657bab7b55e502ff5088ef/packages/puppeteer/package.json#L132

---

## Cached issue snapshot (local, rate-limited)

I pulled issue search results into a local cache (not one-by-one manual querying), with throttling.

- Script: `test-output/research-cache/cache-github-issues.ts`
- Cache root: `test-output/research-cache/playwright-puppeteer-2026-02-26/`
- Manifest: `test-output/research-cache/playwright-puppeteer-2026-02-26/_manifest.json`
- Query metadata: `*.meta.json`
- Raw paged API captures: `*.page-XX.raw.json`

Fetch behavior:
- 1.2s delay between requests (`throttleMs=1200`)
- cache-hit skip on reruns
- paginated fetch up to 1000 items/query (GitHub search cap)

### Electron-related query totals (from cache metadata)

| Query key | Reported total | Fetched |
|---|---:|---:|
| `playwright_feature_electron_open` | 14 | 14 |
| `playwright_feature_electron_closed` | 67 | 67 |
| `playwright_electron_text_open` | 20 | 20 |
| `playwright_electron_text_closed` | 322 | 322 |
| `puppeteer_electron_text_open` | 1 | 1 |
| `puppeteer_electron_text_closed` | 41 | 41 |

### Recent open Electron issues (examples)

#### Playwright (open, Electron-focused)
- #38854 `.fill()` crashes Electron when hidden BrowserWindow + datalist
- #23385 Electron argument placement bug
- #11100 Access Electron context menu in test (feature request)
- #36627 Regression around JS dialog handling
- #30495 route/mock response headers status issue with `onHeadersReceived`

#### Puppeteer (open, Electron-focused)
- #4283 Support Electron and other content embedders (open since 2019)

### Recent closed Electron issues (examples)

#### Playwright (recently closed, Electron-focused)
- #39248 Leaky Electron IPC handlers cause hangs (closed 2026-02-14)
- #39165 Electron app freeze with Windows native file dialog (closed 2026-02-12)
- #39008 `electron.launch()` failure with Electron 30+ (`--remote-debugging-port`) (closed 2026-01-28)
- #38725 Visual artifact issue in Playwright+Electron+Chromium Windows flow

#### Puppeteer (recently closed, Electron-related)
- #12418 Pages in Electron project cannot be connected (closed 2024-05-09)
- #11708 Connect to existing Electron lacks access to existing pages (closed 2024-01-23)
- #11610 Proxy question with Puppeteer+Electron (closed 2024-01-02)
- #4655 Is it possible to run Puppeteer on Electron window? (closed 2022-07-26)

---

## General Playwright vs Puppeteer differences (practical)

For your use case (Electron app test automation):

- **Playwright**
  - Has first-party Electron API (`_electron`, `ElectronApplication`) and dedicated test assets.
  - But Electron support remains marked **experimental**.
  - Stronger built-in test runner/tooling ecosystem around traces/reporting.

- **Puppeteer**
  - Strong browser automation library (Chrome/Firefox focus).
  - No equivalent first-party Electron automation surface in core API.
  - Electron usage is more DIY/community glue/custom-bridge territory.

---

## Bottom line for “which has greatest support”

If the question is specifically **Electron app automation support quality in the official project surface**:

- **Playwright > Puppeteer** (clear first-party API + ongoing Electron issue activity + dedicated tests),
- while still acknowledging Playwright labels Electron support as **experimental**.

If you want maximum determinism for native/macOS behaviors beyond renderer DOM, you still need native/macOS automation layers (AX/AppleScript/CGEvent/etc.) alongside whichever web framework you choose.
