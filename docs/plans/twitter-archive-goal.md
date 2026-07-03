# Twitter Archive Goal

## Outcome

Build `packages/twitter-archive` into a local-first, ban-safe Twitter/X archive workstream for public material and user-supervised bookmark/network captures. The active target is `@communalAI` through public Nitter/public HTML capture, durable SQLite storage, quote content resolution, Wayback/public archive imports, source/provenance metadata, following graph capture/import from public or user-provided sources, browser-history candidate ranking, supervised authenticated browser capture into the local server, local media downloads, Markdown export, and a Bun dev UI that is always runnable while workers continue through SQLite.

Everything in this workstream is TypeScript on Bun with Effect v4 boundaries. Do not add Rust or a second runtime stack.

## Non-goals

- No X login automation, token/cookie extraction, private or unofficial X API endpoints, or client impersonation.
- No posting, liking, following, reposting, bookmarking, DMs, notifications, topics, settings, private/locked accounts, WAF/rate-limit bypass, proxy rotation, or account farming.
- Browser bookmark import has two separate local lanes: Chrome/Arc `Bookmarks` JSON and Firefox `places.sqlite` may seed public profile/status/search scrape candidates with provenance, and authenticated X bookmark/timeline capture comes from user-installed read-only browser helpers: preferred Firefox WebExtension, Violentmonkey userscript fallback, or the dedicated Chrome DevTools extension. None of these lanes stores cookies/tokens or performs Twitter/X mutations.
- No local annotation action (note, tag, mark, label, or comment) is a Twitter/X reply or mutation; annotations stay only in the local archive database.
- No comments/replies deep view in this pass. Preserve reply/thread ids and shallow grouping where stored; a deeper conversation explorer is later work.
- No following graph lane may scrape authenticated/private following lists or perform follow/unfollow actions; use public pages, public archives, or user-provided exports only.
- No scraper-server IPC requirement, external queue, cloud service, or UI framework/runtime outside the package-local Bun/TypeScript stack.

## Operating Model

- SQLite is the durable handoff and source of truth. Scraper, import, following-graph, and media workers write raw pages/import batches, entities, graph edges, jobs, media paths, provenance, and events; the server/UI polls SQLite-derived views.
- Use Effect v4 idioms for new code: `Effect.fn` workflows, `Context.Service`/`Layer` service boundaries, `Schema` decoding at process/file/API boundaries, and `Schema.TaggedErrorClass` for expected errors.
- Keep network activity explicit and low-cap. `@communalAI` is the default smoke target; `@pleometric`, `@teortaxes`, and `@teortaxestex` are named backfill targets once the shared status model is in place. Default Nitter capture remains one page unless a caller deliberately overrides it.
- The dev UI is a local data viewer styled closer to the Twitter/Nitter middle column: one readable timeline column, tweet cards with metrics/time context, actual stored quoted tweet content when resolved, sort/filter by metrics and time, collapsed controls by default with `f` toggling filters and `/` expanding/focusing search, keyboard navigation, and local-only `y` copy-as-Markdown for the selected tweet/thread. It must show capture progress, tweets, shallow thread/reply/quote grouping where stored, media status/local paths, jobs/events/logs, and local note/tag/mark controls for later pipeline categorization.
- Local feedback loop: the dev UI local notes/tags/marks/attributes plus authenticated capture clients — preferred Firefox WebExtension, Violentmonkey userscript fallback, and the `x-bookmark-sync-devtools` dedicated DevTools lane — write only to the localhost `twitter-archive` server, SQLite, JSONL events, and derived Markdown files. They do not post replies, edit bookmarks, call Twitter write endpoints, or change account state.
- Firefox WebExtension is the recommended authenticated path because it can evolve toward browser action/command/RPC control while staying read-only. In normal Firefox, the unsigned development install path is temporary through `about:debugging`; it must be reloaded after browser restart unless a signed or policy-managed distribution exists.
- Capture adapter boundary: the Firefox WebExtension and Violentmonkey fallback send lightweight visible-page payloads such as `pageUrl` plus `visibleTweets` and health pings to localhost, while the Chrome DevTools extension sends observed network-response snapshots; the local server normalizes all of them into one SQLite/Markdown pipeline.
- Signal capture is a first-class extension/workstream concern. The Firefox WebExtension should observe read-only user intent signals such as open X tabs, URL/status navigation, visible tweet dwell time, scroll depth, expanded thread/comment viewing, quote/thread expansion, like/bookmark/reply button clicks as observations, and repeated profile visits. Store these as local signal/event rows tied to nearest tweet/profile/status URL plus source tab/session metadata; never trigger the corresponding Twitter/X mutation from the archive system.
- Account promotion is derived from signals, not hard-coded taste. Repeated dwell/thread-completion/bookmark/like/reply/profile-visit signals should score accounts and lists as high-value candidates for explicit queue promotion, e.g. TPOT/SIM-cluster accounts such as `@zephyr`, `@pleometric`, `@teortaxes`, and user-created X lists. Promotion enqueues safe public/archive/RSS/Nitter-style capture jobs with provenance and caps; it must not scrape private follow graphs or use authenticated write APIs.
- `@pleometric` and artifact-extraction candidates enter the system as explicit `archive_jobs` rows before any scraper runs. The queue/status fields to preserve are `sourceLane`, `targetType`, `targetValue`, `status`, `priority`, `attempts`, timestamps, and provenance detail such as `promotionReason` or `artifactExtractionCandidateId`; showing these rows in the UI is not permission to scrape.
- Markdown export defaults to `data/twitter-archive/markdown/bookmarks`. To export directly into Arthur's Obsidian vault later, set `TWITTER_ARCHIVE_MARKDOWN_ROOT=/Users/arthur/vault/sources/clippings/twitter-bookmarks`; this is direct filesystem output, not an Obsidian app launch. If a different vault path is needed, configure that env var explicitly instead of guessing.
- Browser-history ranking outputs live under `data/twitter-archive/history-analysis.json` and `.csv`. Those derived candidate lists feed `archive_jobs`, then the normal archive worker claims the jobs; history analysis is not a scraper and does not store unrelated raw browsing history in archive artifacts.
- Media download is a worker pipeline, not UI state: download images/videos/GIFs from archived media remote URLs into a durable media directory with low concurrency, local caching, and idempotent `localPath` updates.
- Reference-profile archive exports are derived views over existing Twitter archive rows, not a new scraper lane: `ReferenceProfileArchiveExport` composes `ArchiveUser`, sampled tweet/media ids, timeline provenance, and abstract mechanics so UGC Studio can reuse archived evidence without duplicating source media or archive IDs.
- Append scraper, import, following-graph, media worker, server, and frontend events to one JSONL stream with `component`, timestamp, level, event name, and structured details plus `runId`/`jobId` where available.

## Shared Pipeline-Stage Status Model

Before broad backfill, every worker/API/UI slice should use one boring pipeline-stage vocabulary stored in SQLite and modeled through Drizzle:

| Area | Status values | Invariant |
|---|---|---|
| Raw/parse/entity lifecycle | `raw_fetched`, `parsed`, `normalized` | Raw HTML is durable before parse; parsed output may be re-run from raw; normalized rows are idempotent archive entities. |
| Media lifecycle | `queued`, `downloading`, `downloaded`, `failed` | Media workers only advance rows from stored remote URLs; `downloaded` requires a local file path, size/hash when available, and no duplicate media row. |
| Thread lifecycle | `pending`, `partial`, `complete` | Thread state describes known relationship coverage, not tweet visibility; `partial` is acceptable when caps or public HTML omit replies. |
| Quote lifecycle | `pending`, `resolved`, `unavailable` | Quote metadata is shown only when parsed/stored; `unavailable` records public/deleted/private/rate-limit absence without retry loops. |
| Import/skips | `imported`, `skipped_policy`, `skipped_rate_limit`, `skipped_private`, `skipped_deleted` | Every non-captured or imported record keeps source lane, source URL/dataset, target handle/query, capture/import time, parser/importer version, raw cache key or import batch id, and Wayback snapshot metadata when applicable. |
| Local annotations | `note`, `tag`, `mark` | User-entered notes, attributes, and categorization marks live only in SQLite/Drizzle local tables; captured Twitter metrics remain read-only source observations, not editable annotations. |

SQLite remains the shared source of truth: statuses and local annotations live in database rows, with explicit text columns plus skip/provenance detail JSON where needed, then the API/UI exposes the same values without remapping. Arthur's decision is to move SQLite access to Drizzle now, but as a clean boundary migration owned separately from scraper/UI feature work: Drizzle should encode these as enum-like constants and indexes over run id, job status, media status, and tweet/thread/quote lookup fields without changing the durable status vocabulary.

## Source of Truth

1. `docs/plans/twitter-archive-goal.md` is the resume contract.
2. `docs/twitter-archive-workstreams.md` is the detailed workstream/spec and safety policy.
3. `packages/twitter-archive` SQLite databases are the runtime truth for runs, jobs, raw pages, normalized entities, media paths, statuses, local annotations, and events.
4. The unified JSONL log is the recent operational/event stream; it does not replace SQLite durability.
5. Markdown files are derived review/export artifacts generated from SQLite. The default bookmark export root is `data/twitter-archive/markdown/bookmarks`; Arthur's current Obsidian filesystem target is `TWITTER_ARCHIVE_MARKDOWN_ROOT=/Users/arthur/vault/sources/clippings/twitter-bookmarks`.
6. `TASKS.md` tracks only the current durable task row, not implementation minutiae.

## SQLite Viewing

- Use `bun run dev` from `packages/twitter-archive` as the normal viewer: it serves HTTP/SSE over SQLite-derived views and must not require a live scraper.
- For ad hoc database inspection, open a copied database or an explicit read-only SQLite connection; browser clients must not read/write the live SQLite file directly while workers are active.

## Workstreams

| Workstream | Deliverable |
|---|---|
| Nitter lane | Public Nitter/HTML capture and parsing for `@communalAI` smoke plus `@pleometric`, `@teortaxes`, and `@teortaxestex` backfill targets, raw cache first, normalized tweets/users/media/quote references into SQLite. |
| Quote resolution | Resolve stored quote references against captured/imported tweets and render the actual quoted author/text/media when available; otherwise keep `quote_status` and the unavailable reason visible. |
| SQLite store | Drizzle-backed SQLite boundary for resumable runs/jobs/raw pages/entities/media/events, WAL-friendly polling views, idempotent upserts, shared status/provenance fields, local annotations, Wayback/import batches, and following graph edges. |
| Dev UI/API | `bun run dev` local Bun server with HTTP/SSE/static UI over SQLite, Twitter/Nitter-like single-column viewer, progress/log/jobs/media/quote/status/provenance data, read-only metrics with time/metric sort/filter controls, local-only `y` Markdown copy, local note/tag/mark/attribute controls, and local Markdown export. |
| Browser bookmark/history imports | Local-only Chrome/Arc browser bookmark JSON, Firefox bookmark-table imports, and browser-history ranking outputs that normalize public Twitter/X profile/status/search URLs into scrape candidates and `archive_jobs` with source provenance. |
| Authenticated browser capture | Preferred Firefox WebExtension posts read-only visible tweet/bookmark/profile-card captures and interaction signals to the local dev server at `http://127.0.0.1:3420`; the Violentmonkey userscript can send the same lightweight `pageUrl`/`visibleTweets` payload as a fallback, and the existing `x-bookmark-sync-devtools` extension remains a valid dedicated Chrome/Chromium/Helium DevTools network-capture lane. |
| Signals and promotion | Store extension-observed dwell/navigation/thread-expansion/bookmark/like/reply/profile-visit signals separately from tweets, derive account/list score snapshots, and promote explicit high-value accounts/lists into bounded public/archive/RSS/Nitter-style server jobs with provenance. |
| Markdown export | Bookmark captures and local annotation/yank flows write Markdown under `data/twitter-archive/markdown/bookmarks` by default, or under `TWITTER_ARCHIVE_MARKDOWN_ROOT` for a direct filesystem Obsidian vault path such as `/Users/arthur/vault/sources/clippings/twitter-bookmarks`. |
| Following graph | Capture/import public or user-exported following/follower edges into generic SQLite graph tables with observed-at/source provenance; no authenticated scraping or follow/unfollow mutation. |
| Reference-profile export | Package-level `ReferenceProfileArchiveExport` handoff for UGC reference profiles: compose one profile, sampled tweets/media, source lane/URL/capture metadata, pose/timing/hook/caption/CTA mechanics, preserve/swap/blocked lists, and evidence ids from existing SQLite/archive records. |
| Media downloads | Low-concurrency worker that downloads archived remote media URLs to a durable media directory and updates local paths idempotently. |
| Orchestration/docs | Keep this goal, workstream spec, and `TASKS.md` aligned after meaningful implementation waves. |

## Acceptance Criteria

- `@communalAI` can be captured through the public Nitter/HTML lane with a safe default cap; `@pleometric`, `@teortaxes`, and `@teortaxestex` are available as explicit backfill targets after the status model is wired.
- SQLite contains resumable runs/jobs, raw page cache, normalized users/tweets/media, shared raw/parse/media/thread/quote/import/skip statuses, media local paths when downloaded, quote resolution fields, Wayback/import batch metadata, following graph edges, provenance, local notes/tags/marks, extension interaction signals, account/list score snapshots, promoted scrape targets, and run events.
- The dev server can run locally without an active scraper and reconstruct UI state by polling SQLite/API views; it is also the supported SQLite viewing path for normal review.
- The UI displays progress, Twitter/Nitter-like timeline tweets, available shallow thread/reply grouping, actual stored quote content when resolved, media download status/local paths, jobs/events/logs, provenance, read-only captured metrics, sort/filter by metrics and time, local note/tag/mark controls, local-only `y` Markdown copy, and basic keyboard navigation.
- The local feedback loop is explicit: dev UI local notes/tags/marks/attributes and extension bookmark sync create/update local SQLite rows and Markdown exports only; captured Twitter metrics/relationships remain read-only observations.
- Browser-history analysis produces `data/twitter-archive/history-analysis.json` and `.csv` ranking outputs, imports candidate profile/status targets into `archive_jobs`, and leaves normal workers responsible for capture.
- Signal-derived promotion can rank high-value accounts/lists from repeated dwell, profile visits, completed thread reads, bookmark/like/reply observations, and explicit list seeds, then enqueue bounded server-side scrape targets without extension-side scraping or X mutation.
- Reference-profile handoff can be proven locally without live capture by constructing a `ReferenceProfileArchiveExport` from existing archive rows and checking mechanic evidence ids resolve to stored tweets/media/provenance instead of raw source-media copies.
- Extension safety and install constraints are visible to reviewers: the recommended Firefox WebExtension uses temporary unsigned install via `about:debugging` in normal Firefox, the DevTools lane remains valid for dedicated Chrome-like profiles, all capture lanes run only while the user has X open and is scrolling/visiting pages, save no cookies/tokens, mutate nothing on X, and post only to localhost.
- Media download is idempotent and bounded; reruns do not duplicate downloaded files or corrupt existing `localPath` rows.
- Unified JSONL logs include scraper, import, following-graph, media, server, and frontend events with component/run/job context.
- Safety constraints remain explicit in code paths and docs: public HTML/public archives/user-provided exports/already-stored media only, no X auth automation, no private APIs, no mutations, no bypass tactics.

## Validation Commands

Parent/orchestrator should run these from the package when implementation workers finish relevant slices:

```sh
cd packages/twitter-archive
bun run typecheck
bun test
bun run smoke:nitter:communalai -- --max-pages 1
bun run dev
```

For dev UI smoke, open the local server, confirm the API exposes progress/tweets/media/jobs/events/logs/provenance/quotes from SQLite, and confirm the browser shows the Twitter/Nitter-like single-column viewer without requiring a live scraper. Also confirm the sticky sort/filter controls change the visible tweet rows, `f` toggles the collapsed filters, `/` expands controls and focuses search, `j`/`k` moves the selected group, and `y` copies the selected tweet/thread group as Markdown with a visible status toast.
For bookmark-extension smoke, while `bun run dev` is active on `http://127.0.0.1:3420`, open the DevTools panel on X under the user's control, capture a small bookmark/network response, post it to the local endpoint, and verify SQLite/API state plus Markdown output under `data/twitter-archive/markdown/bookmarks` or `TWITTER_ARCHIVE_MARKDOWN_ROOT`. Do not inspect or store cookies/tokens, and do not perform X mutations.
For browser-history queue smoke, review `data/twitter-archive/history-analysis.json`/`.csv`, import a bounded candidate set into `archive_jobs`, then confirm the worker claims those jobs through the same SQLite queue path as other archive work.
For the `@pleometric`/artifact-extraction continuation, the no-live-scrape queue proof is:

```sh
cd packages/twitter-archive
tmpdir="$(mktemp -d)"
printf '%s\n' '{"candidates":[{"username":"pleometric","priority":7,"provenance":{"source":"artifact-extraction-candidate","artifactExtractionCandidateId":"pleometric-proof-1"}}]}' > "$tmpdir/pleometric-artifact-candidates.json"
bun src/browser-history-queue.ts "$tmpdir/pleometric-artifact-candidates.json" --db "$tmpdir/archive.sqlite"
```

Expected result is one queued profile job for `pleometric`, zero skipped candidates, preserved artifact-candidate provenance, and no public HTML fetch.

Additional explicit backfill targets such as `@pleometric`, `@teortaxes`, and `@teortaxestex` should be validated with separate bounded commands after the shared status model is wired; they are not hidden defaults for the `@communalAI` smoke path.

## Resume Command

Copy/paste the full restart prompt from `docs/plans/twitter-archive-goal-command.md`. Minimal form:

```txt
/goal Drive the Twitter archive workstream to completion from @docs/plans/twitter-archive-goal.md, @docs/twitter-archive-workstreams.md, @TASKS.md, and @packages/twitter-archive.
```

The next agent should read this goal, `docs/twitter-archive-workstreams.md`, `TASKS.md`, and the package files before choosing a slice; do not re-litigate the architecture unless one of those files contradicts the implementation.