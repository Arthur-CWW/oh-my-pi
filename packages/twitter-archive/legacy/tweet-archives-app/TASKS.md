# Implementation Task Specs

- Short URL Resolution (t.co)
  - Goal: Expand Twitter short links to originals.
  - Logic: Use the `urls` column to map `t.co` → expanded URL; fall back to parsing tweet `text` when needed. Verify example `https://t.co/tzvR2KMRpY` expands correctly.
  - UI: Render anchors with expanded domain; tooltip shows full URL.
  - Acceptance: All `t.co` links resolve to correct targets.

- Quote Tweets: Resolve and Click-Through
  - Goal: Detect `twitter.com/.../status/<id>` in `links` and render a quote-tweet card under the text.
  - Click behavior: Link to the original tweet (in-app anchor `#t-<id>` if available; else open external URL).
  - Acceptance: Quote card links to the original, not just a preview.

- Original Tweet URL Source
  - Goal: Use the first Twitter status URL from `links` as the canonical “View original” link.
  - Fallback: Default to `https://twitter.com/GCRClassic/status/${tweet_id}` when absent.
  - Acceptance: Link matches `links` when available.

- Image/Media Reliability
  - Goal: Fix PNGs and broken media.
  - Logic: Parse multiple `media_urls`; normalize schemes; attempt sequential sources; show placeholder on 404; lazy-load.
  - Acceptance: PNGs render reliably; broken sources degrade gracefully.

- YouTube Embeds
  - Goal: Render YouTube links as responsive 16:9 iframes.
  - Logic: Detect `youtube.com/watch?v=` and `youtu.be/` patterns; extract `videoId`; embed with safe params.
  - Acceptance: Videos play inline without layout shift.

- Keyboard Navigation (Vim-style)
  - J/K: Focus + scroll to next/previous tweet; highlight focused.
  - H/L: Navigate previous/next media within a tweet gallery; otherwise no-op.
  - Y: Yank JSON of focused tweet to clipboard with a toast.
  - i: Open right-side Sheet showing pretty JSON; Esc closes; focus returns.
  - Acceptance: Global shortcuts work and don’t steal focus from inputs.

- Dev/Debug Utilities
  - Add `debug:link` CLI to print tweets containing a given URL (including `t.co`) and their expanded links.
  - Acceptance: `bun run debug:link https://t.co/tzvR2KMRpY` outputs matching tweet(s) + expansions.

- Docs
  - Update README/AGENTS with keyboard shortcuts, quote-tweet behavior, and link/media rules.

- Cleanup (this session)
  - Move utility scripts into `scripts/` and update `package.json`/docs.
