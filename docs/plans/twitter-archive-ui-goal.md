# Twitter Archive UI Goal: copy-twitter-ui-ux-important-parts

## Outcome

Make `packages/twitter-archive`'s local dev UI feel like the important read-only parts of the Twitter/X or Nitter middle column instead of a huge inline control panel. The page should open as a compact single-column archive viewer: controls collapsed or compressed, tweets readable at normal feed density, reply/quote/retweet relationships visible in context, media laid out like feed cards, and local archive actions available without pretending to be Twitter actions.

This is a focused UI wave. Keep the existing `bun run dev` entrypoint, `/api/state`, `/api/social-graph`, media-file route, note/attribute endpoints, shortcuts, package-local TypeScript/Bun stack, SQLite/JSONL source-of-truth model, and local Markdown export root intact.

## Resume Prompt

```txt
/goal copy-twitter-ui-ux-important-parts for @packages/twitter-archive from @docs/plans/twitter-archive-ui-goal.md, @docs/plans/twitter-archive-goal-command.md, @docs/twitter-archive-workstreams.md, and @TASKS.md.

Keep the viewer read-only and SQLite-derived. Preserve `bun run dev`, `/api/state`, `/api/social-graph`, media-file route, note/attribute endpoints, and shortcuts. Implement only the important Twitter/Nitter middle-column UX: compact header, controls collapsed by default (`f` toggles controls; `/` expands and focuses search), tweet author row, `Replying to @...`, resolved quote cards, media/video grid, retweet attribution as observed relationship only, compact metrics, local annotations/`y` yank, and `j`/`k` selection. Exclude DMs, notifications, topics, sidebars, login/private APIs, mutations, and full Twitter interactions.
```

## Implementation Status

This document is the acceptance contract for the UI wave, not proof that the UI is complete. Implementation agents should inspect `packages/twitter-archive` and use the validation section below before marking the wave done.

## Non-goals

- No React, Solid, shadcn, or new UI runtime unless an implementation owner also wires all build, test, and package-local dev behavior in the same slice. Prefer boring TypeScript modules plus CSS extraction.
- No X login automation, tokens/cookies, private or unofficial APIs, DMs, notifications, topics, unsupervised bookmark scraping, sidebars, recommendations, settings, private/locked accounts, or full Twitter interaction clone. Supervised bookmark captures must arrive as local archive data through the recommended authenticated capture hierarchy: Firefox WebExtension first, Violentmonkey userscript fallback second, dedicated Chrome DevTools capture still valid when needed.
- No posting, liking, following, reposting/retweeting, bookmarking, replying, deleting, or other mutating Twitter/X actions.
- No bypass/proxy/rate-limit/WAF behavior and no UI button that implies an unsupported network action.
- No deep comments/replies explorer in this wave. Show reply context and shallow self-thread grouping from stored relationships; leave full conversation browsing for later.

## UI Reference

Copy the important parts of the Twitter/X or Nitter middle column only:

- One centered feed column with Twitter/Nitter-like width, border rhythm, spacing, and tweet-card density.
- Compact sticky header showing the selected archive/target and a small status summary.
- Controls collapsed behind a compact toolbar or disclosure so filters, sort, jobs, logs, and provenance do not consume half the viewport; `f` toggles controls, and `/` expands controls and focuses search.
- Tweet author row with avatar, display name, handle, timestamp, source/provenance affordance, and compact relationship badges.
- Feed cards that prioritize text/media content first, then local controls and archive metadata.

Explicitly do not copy sidebars, notification flows, DM surfaces, trends/topics, recommendations, login/account switching, composer/post controls, or full Twitter interaction behavior.

## Important Parts to Copy

1. Middle column only: the primary view is a single readable feed column, not a dashboard of giant panels.
2. Compact header: target/run status stays visible but short; large setup/status controls move into collapsed panes.
3. Collapsed controls: filters, sort, jobs/events/logs, provenance, and SQLite details are collapsed by default; `f` toggles the control drawer, and `/` expands controls and focuses search.
4. Tweet author row: avatar, display name, `@handle`, time/permalink context, and source badges follow familiar Twitter/Nitter hierarchy.
5. Reply context: replies show `Replying to @...`; replies are not promoted into a main thread group unless the stored relationship indicates a self-thread by the same author.
6. Quote card with resolved content: quote tweets render stored quoted author/text/media when `quote_status = resolved`; unresolved/unavailable quotes show the status and concrete reason, not a fake empty card.
7. Media/video grid: images, GIFs, and videos render in rounded Twitter/Nitter-like cards; multiple media use a compact grid, images preserve sensible aspect handling, videos render inline with controls/poster when local or archived data is available.
8. Retweet attribution: retweets/reposts can be archived and displayed as observed attribution/relationship, such as "Alice reposted", but the UI must not perform retweet/repost as an action.
9. Metrics: reply/repost/like/view counts are read-only captured observations, displayed compactly and usable for sort/filter where data exists.
10. Local annotations/yank/export: note/tag/mark/attribute controls are local archive actions only; `y` copies the selected tweet or assembled self-thread as Markdown, and persisted bookmark Markdown exports are generated from SQLite under the configured local export root.
11. J/K selection: keyboard navigation keeps a selected tweet, supports `j`/`k` movement, and scopes `y`/local actions to that selected tweet.

## Data Requirements

The UI should be driven by SQLite-derived API data, not by ad hoc client state:

- Tweet rows include stable id, author handle/display/avatar when available, text/html-derived content, created/observed time, source URL, provenance, captured metrics, and local annotation state.
- Relationship data distinguishes normal tweets, replies, self-thread links, quote references, and observed retweet/repost attribution. Retweets/reposts are archival relationships only; they are never executable actions.
- Reply payloads expose `in_reply_to_tweet_id`, target author handle when known, conversation/thread id, and enough author identity to decide whether shallow grouping is a self-thread.
- Quote payloads expose `quote_status`, quoted tweet id/url, unavailable reason when applicable, and resolved quoted author/text/media fields when present in SQLite/imports.
- Media payloads expose type, local media route/path status, remote/archive source when stored, alt text when visible, dimensions/aspect metadata when known, poster/thumbnail/duration for video when known, and download status.
- API responses keep `/api/state`, `/api/social-graph`, media-file route, note/attribute endpoints, existing shortcuts, and JSON/SSE shape conceptually compatible with package tests.
- Markdown export payloads are derived from stored SQLite rows and local annotations. The default bookmark export root is `data/twitter-archive/markdown/bookmarks`; `TWITTER_ARCHIVE_MARKDOWN_ROOT=/Users/arthur/vault/sources/clippings/twitter-bookmarks` may redirect output straight into Arthur's Obsidian vault by filesystem path without launching Obsidian.
- Authenticated capture inputs still arrive only through the local archive server: preferred Firefox WebExtension, Violentmonkey fallback userscript, or dedicated Chrome DevTools capture. The UI consumes only the resulting SQLite-derived local data.

## Acceptance Criteria

- First viewport looks like a Twitter/Nitter middle-column archive feed, not an admin panel; top controls no longer take half the screen, controls are collapsed by default, `f` toggles them, and `/` expands and focuses search.
- `bun run dev` still serves the local Bun UI/API without requiring a live scraper.
- Tweet cards show the author row, text, compact metrics, provenance affordance, local annotation/yank controls, and media in feed-card density.
- Replies render `Replying to @...`; only same-author/self-thread relationships are visually grouped as a thread.
- Quote cards use resolved stored content when available and show explicit unavailable status/reason otherwise.
- Media and videos render in rounded grid/card layouts with inline video controls when available and sane image aspect handling.
- Retweet/repost observations are displayed as attribution/relationship only; there is no retweet action.
- `j`/`k` selection and `y` Markdown copy still work, and local note/tag/mark/attribute actions remain local-only.
- The UI feedback loop remains local: note/tag/mark/attribute edits update SQLite and Markdown export state only, and authenticated capture inputs from the recommended Firefox WebExtension → userscript fallback → dedicated Chrome DevTools hierarchy appear only as local archive data; no control implies a Twitter/X write.
- The UI keeps read-only safety boundaries obvious: captured metrics and relationships are observations; local annotations are archive metadata; no Twitter/X mutation is exposed.

## Current Implementation Handoff

- `packages/twitter-archive/src/dev-ui-styles.ts` is the package-local CSS asset for this wave; `dev-ui-server.ts` serves it at `/assets/dev-ui.css`.
- `packages/twitter-archive/src/dev-ui-client.ts` owns the no-framework component helpers for the compact controls, Twitter/Nitter-style feed rows, reply/repost context, quote cards, and media grids.
- Keep future UI slices read-only and package-local. Prefer extending these helpers and CSS classes over reintroducing inline HTML/CSS in `renderHtml()`.

## Validation Commands

Parent/orchestrator should run validation after implementation workers finish this UI wave; this doc update does not run commands:

```sh
cd packages/twitter-archive
bun run typecheck
bun test
bun run dev
```

Browser smoke while `bun run dev` is active:

- Open the local dev UI and confirm the initial viewport is the compact middle-column feed.
- Fetch `/api/state` and `/api/social-graph`; confirm existing JSON routes still respond from SQLite-derived state.
- Open at least one media-file URL from the UI/API and confirm local media routing still works.
- Exercise `j`, `k`, `y`, `f`, `/`, note/tag/mark/attribute controls, collapsed filters/sort/jobs/logs/provenance panes, resolved quote cards, reply context, retweet attribution, and media/video grids.
- Create or edit one local note/tag/mark/attribute and confirm the UI reflects a local SQLite/Markdown-backed archive change rather than a Twitter/X action.

If a fresh public capture is explicitly allowed for a broader archive smoke, the existing bounded command remains:

```sh
cd packages/twitter-archive
bun run smoke:nitter:communalai -- --max-pages 1
```
