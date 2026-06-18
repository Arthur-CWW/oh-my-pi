# vidIQ Vision Reverse Engineering

Source: local Chrome profile snapshot of `pachckjkecffpdphbpmfolblodfkgbhl`, version `3.196.2`.

Chrome Web Store listing: `https://chromewebstore.google.com/detail/vidiq-vision-for-youtube/pachckjkecffpdphbpmfolblodfkgbhl`

## Manifest Surface

- Main YouTube/Studio content script: `bundle.bundle.js` with `bundle.css`.
- Background service worker: `background.bundle.js`.
- YouTube embed helper: `getIframeVideoStill.bundle.js`.
- vidIQ webapp bridge/login scripts: `extensionLogin.bundle.js`, `webappMessaging.bundle.js`.
- Extra surfaces also exist for TikTok, Instagram, Claude, ChatGPT, and Gemini; those are out of scope for the YouTube UI clone.

## UI Features To Rebuild

The screenshot target is not a single widget; it is a set of mounted React components injected into YouTube pages:

- Channel stats modal/card surface: strings around `Channel Stats`, `views gained`, `subscribers gained`, `videos published`, `estimated earnings`.
- Video list badges: CSS classes around `.vidiq-hijacked-lockup-video`, `.vidiq-social-stats`, `.vidiq-video-preview-video-badge`.
- Outlier/VPH badges: `OutlierPopover`, `VphPopover`, `.vidiq-vph-popover`, and `views_per_hour` data fields.
- Search/sidebar scores: `.vidiq-search-scores`, `.vidiq-search-overall-score-number-main`, `.vidiq-search-top-keyword-score`, `.vidiq-search-trending-video-vph`.
- Inline keyword chips: `.inline-keywords`, `.vidiq-inline-keywords-wrapper`.

## Clean-Room UI Prototype

The rebuild lives at `extensions/youtube-stats-overlay`. It renders a SolidJS content-script panel into YouTube watch pages using dummy data:

- right-rail stats card,
- Views/Overview/AI Coach segmented control,
- engagement, outlier, and VPH metric pills,
- views-over-time chart,
- similar-thumbnail CTA,
- title changes card.

Build it with:

```bash
pnpm build:youtube-stats-overlay
```

Then load `extensions/youtube-stats-overlay/dist` as an unpacked extension.

## Live DOM Capture

When Chrome is running with a DevTools remote debugging port, capture live vidIQ-injected DOM with:

```bash
pnpm capture:vidiq-dom
```

The tool writes JSON and escaped HTML snapshots under `captures/dom`. It captures open shadow roots when available, but closed extension shadow roots cannot be read through page JavaScript.

## Data/API Surface

First-pass bundle scan found these important base URLs:

- `https://api.vidiq.com/`
- `https://api.vidiq.com/v2/`
- `https://api.vidiq.com/pyapi/`
- `https://youtube-videos.vidiq.com/youtube/videos/`
- `https://www.youtube.com/youtubei/v1/...`
- `https://studio.youtube.com/youtubei/v1/...`
- `https://www.youtube.com/api/analytics/yta/query`
- `https://suggestqueries.google.com/complete/search`

The reusable clone should avoid depending on vidIQ tokens. Treat their endpoints as captured fixtures, then replace the data layer with:

- YouTube page/initial data extraction for visible channel/video IDs.
- YouTube public/Innertube requests where available.
- Cached proxy fixtures for unavailable proprietary vidIQ metrics.
- Dummy calculated metrics for prototype UI: `views_per_hour`, `outlier_score`, `subscriber_count`, `views_gained`.

## Proxy/Replay Plan

Start the local cache proxy:

```bash
pnpm proxy:vidiq
```

Proxy URL form:

```text
http://127.0.0.1:4873/https/api.vidiq.com/v2/...
http://127.0.0.1:4873/https/youtube-videos.vidiq.com/youtube/videos/...
```

Modes:

- `VIDIQ_PROXY_MODE=proxy` fetches upstream and writes cache entries.
- `VIDIQ_PROXY_MODE=replay` only serves cached entries.
- `VIDIQ_PROXY_MODE=dummy` serves cached entries and returns `{}` for misses.

Next implementation step: create a patched copy of the unpacked extension with the vidIQ base URL constants redirected to the proxy, load it unpacked, and capture the exact request shapes while using YouTube normally.

## Build Direction

Do not reuse the minified proprietary UI code directly. Rebuild the useful UX in our own extension:

- Content script observes YouTube route changes and video grid mutations.
- Extract video IDs and channel IDs from anchors, thumbnail URLs, and `ytInitialData`.
- Fetch data through our own provider interface.
- Render small, stable React/Solid components into YouTube DOM anchors.
- Keep a fixture-backed replay mode for design and testing.
