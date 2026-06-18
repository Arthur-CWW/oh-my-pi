# Twitter Archive Goal Command

Copy/paste this into Codex when restarting the Twitter archive workstream:

```txt
/goal Drive the Twitter archive workstream to completion from @docs/plans/twitter-archive-goal.md, @docs/plans/twitter-archive-ui-goal.md, @docs/twitter-archive-workstreams.md, @TASKS.md, and @packages/twitter-archive.

Implement only in TypeScript/Bun/Effect v4; do not add Rust. Keep SQLite as the source of truth: scraper, import, media, and following-graph workers write runs/jobs/raw pages/import batches/entities/graph edges/media paths/provenance/events, while the Bun API/dev UI polls SQLite-derived views. Keep one unified JSONL event log for scraper, imports, following-graph, media, server, and frontend events.

Honor the safety policy: public Nitter/public HTML, Internet Archive CDX/Wayback snapshots, user-provided exports/local archives, and already-stored archived media URLs only; no X login automation, token/cookie extraction, private/unofficial X API endpoints, posting/liking/following/bookmark mutation, DMs/notifications/topics/private accounts, WAF/rate-limit bypass, or proxy rotation. Retweets/reposts can be archived only as observed attribution/relationship data, not performed as an action. Use @communalAI as the default low-cap smoke target.

Finish the current implementation wave end-to-end: Nitter capture into SQLite, quote content resolution/rendering from stored tweets/imports, Wayback/public archive import listing, source/provenance metadata, generic public/user-export following graph capture/import, idempotent media downloads to a durable media directory, `bun run dev` local Bun server, and the focused `copy-twitter-ui-ux-important-parts` UI wave from @docs/plans/twitter-archive-ui-goal.md. For the dev UI, keep the Twitter/Nitter-like middle column only: compact header, collapsed controls (`f` toggles filters; `/` expands and focuses search), tweet author row, `Replying to @...` context, resolved quote cards, media/video grid, retweet attribution as read-only relationship, compact metrics, local annotations/`y` yank, and `j`/`k` selection. Keep comments/replies deep view as later work. Parent/orchestrator owns validation with package-local commands only: `cd packages/twitter-archive && bun run typecheck`, `bun test`, `bun run smoke:nitter:communalai -- --max-pages 1`, and `bun run dev` plus a browser smoke of the local UI/API.
```
