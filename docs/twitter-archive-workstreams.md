# Twitter/X Archive Workstreams

This spec defines the first safe, read-only lane for `packages/twitter-archive` and the follow-on workstreams reviewers can assign in parallel. The resumable goal artifact is `docs/plans/twitter-archive-goal.md`; the focused UI wave is `docs/plans/twitter-archive-ui-goal.md` (`copy-twitter-ui-ux-important-parts`); the copy/paste restart prompt is `docs/plans/twitter-archive-goal-command.md`.

## Decision Record

Architecture is TypeScript/Bun/Effect v4 only, with no Rust: Effect services/layers over SQLite as the single durable source of truth. Scraper, import, following-graph, and media workers write events, raw pages/import batches, normalized entities, graph edges, media paths, and job state; the API/UI server is read-mostly and polls SQLite-derived views. Bun owns the local runtime and process boundaries, including the current dev server/UI and unified JSONL event stream.
## Authenticated Capture Hierarchy

1. Firefox WebExtension is the preferred authenticated path. A Firefox-only WebExtension on `x.com`/`twitter.com` uses host permissions, content scripts, extension storage or alarms, and background-script messaging to extract visible tweets, bookmarks, and profile cards from the page while staying read-only. This is the best base for future browser action, command, and RPC control.
2. Violentmonkey userscript is the fallback extractor. It runs inside the current authenticated page DOM, uses manual menu or command triggers, a localhost health ping, and lightweight `pageUrl` plus `visibleTweets` payloads. Keep it as the low-friction recovery path when extension install is blocked.
3. `x-bookmark-sync-devtools` remains valid for dedicated Chrome/Chromium/Helium DevTools capture. It sees network responses rather than page DOM, so it stays useful for bookmark/network-specific review, but it is not the preferred long-term control surface.

### Adapter/API Differences

| Lane | Browser surface | Local API shape | Best use | Explicit limits |
|---|---|---|---|---|
| Firefox WebExtension | Content script plus background script with host permissions, extension storage/alarms, browser action, and commands. | Localhost health ping plus visible-page ingest, starting with userscript-compatible `pageUrl` and `visibleTweets` payloads, with extension messaging and optional native messaging reserved for future RPC. | Preferred authenticated path and future browser-control evolution. | In normal Firefox the unsigned dev install is temporary through `about:debugging`; no cookie/token extraction, no mutations, localhost only. |
| Violentmonkey userscript | Manual userscript running in the current authenticated page DOM. | Same lightweight `pageUrl` and `visibleTweets` POST plus `GET /api/health` ping from page context. | Lowest-friction fallback when extension install is blocked. | Manual trigger only; subject to visible-page DOM and page-context fetch constraints; no persistent background runtime, browser action, or richer RPC surface. |
| Chrome DevTools extension | DevTools network inspection in Chrome/Chromium/Helium. | POST network-response capture snapshots and tweet-like records to localhost. | Dedicated-profile bookmark/network debugging and DevTools-first capture. | Requires DevTools and a Chrome-like browser; weaker foundation for general browser control. |
| Optional debugger/native bridge | Local daemon talking to CDP, BiDi, or native helper boundaries outside the page. | Localhost RPC between daemon and extension, never direct X private API replay. | Future tab discovery, debugger-only metadata, native affordances, or daemon-controlled browser coordination when DOM capture alone is insufficient. | Optional only; never used for credential extraction, private API replay, or mutation. |

## Goal

Build a local-first archive for selected public Twitter/X material and user-supervised bookmark/network captures that can safely capture public profiles, timelines, tweet/thread URLs, browser-history-derived candidates, and bookmark DevTools responses without automating X login or mutating any account state.

## Non-goals

- No messages, notifications, topics, private/locked accounts, account settings, recommendations, or unrelated sidebars.
- No posting, liking, following, reposting/retweeting, bookmarking, DM access, or other mutating actions. Retweets/reposts may be archived only as observed attribution/relationship data, not performed as an action.
- No login automation, token/cookie extraction, private or unofficial X API endpoints, client impersonation, rate-limit/WAF bypass, proxy rotation, or account farming.
- Browser bookmarks, browser history, and authenticated X capture are separate lanes: local Chrome/Arc bookmark JSON, Firefox bookmark tables, and derived history-analysis outputs may be imported as profile/status/search scrape candidates, while authenticated X bookmark/timeline contents come only from explicit user-installed browser helpers posting to localhost.
- No local note, tag, mark, label, attribute, or comment is a Twitter/X reply or mutation; annotations are local SQLite/Drizzle rows only.
- No comments/replies deep view in this pass. Store reply/thread ids and show shallow grouping where available; a full conversation explorer is later work.
- No following graph lane may scrape authenticated/private following lists or perform follow/unfollow actions. It is capture/import of public or user-exported graph observations only.
- No emusks execution or integration in this pass; it is research-only background material.

## Read-only and Safety Constraints

- Treat every lane as archival read-only capture; adapters must not expose write/mutation helpers.
- Fetch/import only public Nitter/mirror HTML, public Internet Archive CDX/Wayback snapshots, user-provided local/exported data, and already-stored archived media URLs in V1.
- Stop or skip on login walls, private/locked content, rate-limit/WAF blocks, CAPTCHA, or suspicious-activity interstitials.
- Do not add retries or fallbacks whose purpose is to bypass platform controls.
- Captured metrics such as reply/repost/like/view counts and retweet/repost attribution are read-only observations from the source; local notes/tags/marks must not overwrite them.
- Authenticated browser helpers may observe X/Twitter page DOM or DevTools network responses only while the user is logged in, controls which page is open and scrolled, and explicitly runs the helper. They may POST captured data to the localhost dev server only; they must not save cookies, bearer tokens, or CSRF tokens, and must not replay private API requests.
- Extension and dev UI feedback actions write local SQLite rows, JSONL events, and Markdown exports only. They must never call Twitter/X mutation endpoints or present local notes/attributes as Twitter replies/bookmarks.

## Functional Requirements

1. Expose package-local TypeScript APIs from `src/index.ts` for safe read-only capture and normalized archive records.
2. Implement a Nitter/public HTML adapter that can fetch and parse profile timeline pages, tweet cards, media references, and tweet/thread URLs with a low page cap.
3. Provide a CLI smoke path for `@communalAI`; `--max-pages` defaults to `1` and higher values require an explicit user flag/value. After the status vocabulary is wired, expose `@pleometric`, `@teortaxes`, and `@teortaxestex` as explicit backfill targets, not as hidden defaults.
4. Cache every fetched raw page before parsing so parser fixes do not require immediate refetches.
5. Upsert normalized `ArchiveUser`, `ArchiveTweet`, and `ArchiveMedia` records into SQLite without duplicating records across resumed runs.
6. Record provenance on every raw and normalized record: source lane, source URL, handle/query, capture/import timestamp, parser/importer version if available, raw cache key, import batch id, source dataset, and Wayback snapshot timestamp/url when applicable.
7. Make backfills resumable at page/job granularity; interruption should leave enough state to continue without redoing successful pages.
8. Resolve quote tweets against stored tweets, imported archive rows, and parsed quote cards. When resolved, API/UI payloads must include the actual quoted author/text/media available in SQLite; otherwise keep `quote_status` and a concrete unavailable reason.
9. Import/list public archive material from Internet Archive CDX/Wayback snapshots plus user-provided/local exports into the same normalized records, preserving snapshot URL/timestamp and batch metadata.
10. Import local browser bookmark files/read-only DB rows as candidate profile/status/search targets only, preserving browser source path/profile/folder/title/timestamp provenance and keeping X authenticated bookmarks out of scope.
11. Capture/import following/follower graph edges only from public pages, public archive snapshots, or user-provided exports; store observed edge provenance without login automation or follow/unfollow mutation.
12. Keep existing JSONL helpers intact; SQLite is the new resumable cache/store boundary, not a reason to delete JSONL utilities.
13. Download archived images/videos/GIFs from stored media remote URLs into a durable media directory with low concurrency; reruns update `localPath` idempotently without duplicating media rows.
14. Serve a package-local Bun dev UI/API that can run without a live scraper by reading SQLite. The active UI target is `docs/plans/twitter-archive-ui-goal.md` (`copy-twitter-ui-ux-important-parts`): Twitter/Nitter-like middle column only, compact header, controls collapsed by default (`f` toggles controls, `/` expands and focuses search), tweet author rows, `Replying to @...` context, self-thread-only grouping, resolved quote cards, rounded media/video grids with inline controls when available, observed retweet attribution, compact read-only metrics, metric/time sort and filters, local-only `y` copy-as-Markdown, `j`/`k` selection, local note/tag/mark buttons, media status/local paths, provenance, jobs/events/logs, and browser-smokeable JSON/SSE data.
15. Ingest supervised bookmark/network/visible-page captures from the preferred Firefox WebExtension, the Violentmonkey fallback userscript, and `browser-extensions/extensions/x-bookmark-sync-devtools` through the local dev server, defaulting to `http://127.0.0.1:3420`; these clients are capture helpers only and the server owns normalization, SQLite persistence, JSONL logging, and Markdown export.
16. Export bookmark/tweet Markdown from stored rows under `data/twitter-archive/markdown/bookmarks` by default. If exporting directly to Obsidian, use `TWITTER_ARCHIVE_MARKDOWN_ROOT=/Users/arthur/vault/sources/clippings/twitter-bookmarks` or another explicit filesystem path; do not launch Obsidian or guess vault locations.
17. Treat `data/twitter-archive/history-analysis.json` and `.csv` as derived ranking outputs. Import their candidate profile/status targets into SQLite `archive_jobs`, then let the normal worker claim jobs; the history analyzer itself is not the scraper.

## Non-functional Requirements

- Bounded by default: one fetch at a time, low max pages, no tight loops, and cache-before-fetch behavior.
- Local-first: all state lives under the package/user data path chosen by the caller; no cloud dependency.
- Deterministic parsing tests should use fixtures where possible; live smoke is opt-in and low-cap.
- Source adapters must be replaceable without changing archive entity types or viewer code.
- Store code may use Bun's built-in `bun:sqlite` only inside an explicit boundary module.
- No explicit `any`, no `.js` import extensions, and follow existing TypeScript/Bun test conventions in `packages/twitter-archive/test`.

## Source Lanes

| Lane | Status | Scope | Explicit limits |
|---|---|---|---|
| `old-nitter-public-mirrors` | V1 implementation | Public Nitter/HTML mirror profile timelines and tweet/thread pages, starting with `@communalAI` smoke and adding explicit `@pleometric`, `@teortaxes`, and `@teortaxestex` backfill entries after status fields exist. | Low caps, public HTML only, no WAF/rate-limit bypass, no mirror rotation tricks. |
| `wayback-public-archives` | Import workstream | Internet Archive CDX lookup/listing and Wayback Twitter/X snapshot import for public URLs/handles/tweet URLs. | Public archive metadata/snapshots only; bounded CDX queries; preserve snapshot URL/timestamp/status/source; no replay login or bypass flows. |
| `old-archives-datasets` | Import workstream | Existing local exports, public datasets, legacy SQLite/JSONL archives, user-provided exports, and downloaded historical files. | Respect dataset licenses and provenance; do not blend imported data without source metadata. |
| `browser-bookmark-import` | Import workstream | Local Chrome/Arc `Bookmarks` JSON and Firefox `places.sqlite` bookmark rows that contain public Twitter/X profile, status, or search URLs. | Local read-only files/DBs only; preserve bookmark source provenance; do not infer or scrape authenticated X bookmark contents. |
| `browser-history-derived-targets` | Import workstream | `data/twitter-archive/history-analysis.json` and `.csv` rank local Chrome/Firefox history-derived public Twitter/X profile/status/search candidates, then enqueue selected profile/status targets into SQLite `archive_jobs` for normal workers. | Derived target lists only; do not store full raw browsing history in package artifacts unless explicitly needed as a fixture; never scrape via browser IPC. |
| `following-graph-public` | Capture/import workstream | Generic public or user-exported following/follower edge observations keyed by account and observed time. | No authenticated scraping, private accounts, follow/unfollow mutation, or Arthur-specific following scrape without a handle/export. |
| `browser-capture` | Future supervised lane | Human-visible public/authorized main tweet/search/thread column capture when public mirrors are insufficient. | No login automation or credential extraction; no DMs, notifications, settings, sidebars, or private accounts. |
| `firefox-webextension-capture` | Preferred authenticated lane | Firefox WebExtension on authenticated `x.com`/`twitter.com` pages extracts visible tweets, bookmarks, and profile cards, then POSTs to localhost through a background script. | Default dev install is temporary unsigned load through `about:debugging`; no cookie/token extraction, no mutations, localhost only. |
| `violentmonkey-visible-dom-fallback` | Fallback authenticated lane | Manual userscript on authenticated pages sends lightweight `pageUrl`/`visibleTweets` capture plus health ping to localhost. | Manual trigger only; same read-only DOM surface; no background RPC or browser action. |
| `bookmark-extension-devtools-sync` | Implementation workstream | User-installed `x-bookmark-sync-devtools` observes X bookmark/network responses in a DevTools panel and POSTs capture payloads to the local dev server. | Runs only while the user is logged in and controlling the X page/scrolling; localhost only; no cookies/tokens saved; no X mutation or private API replay. |
| `emusks-research` | Research only | Read prior research to understand risks and possible data shapes. | Do not import, execute, or depend on emusks code in this package. |

## Resumable SQLite Backfill Model

Use SQLite as the durable job/cache/store for capture runs:

- `archive_runs`: run id, lane, target, options, status, started/finished timestamps, counters, and last error.
- `archive_jobs`: durable queue rows for profile timeline, status/detail, search query, Wayback import, following graph/import jobs, browser-history-derived targets, and bookmark-extension-derived targets; fields include source lane, target type/value, priority, status, created/claimed/finished timestamps, options JSON, and provenance JSON. Dev server `POST /api/archive-jobs` only mutates this local DB queue; `GET /api/archive-jobs` lists queued work.
- `raw_pages`: source URL, lane, fetched_at, HTTP metadata when available, content hash, raw body/blob path or inline body, and parser status.
- `archive_users`: stable platform user id when known, handle, display name, avatar/media references, observed timestamps, and source provenance.
- `archive_tweets`: stable tweet id, author id/handle, text/html-derived content, created time when known, reply/quote/thread ids, quoted author/text/media payload or relationship when available, counters when visible, observed timestamps, and source provenance.
- `archive_media`: stable media id or content hash, tweet id, media type, source URL, local path when downloaded, alt text when visible, and source provenance.
- `social_graph_nodes` / `social_graph_edges`: observed account nodes and following/follower edges, relation type, observed_at, source lane/url/dataset, import batch id, and confidence/status detail.
- `import_batches`: import id, source lane, source dataset/url, requested target, capture/import timestamps, importer version, counters, and policy/skip detail.
- `parser_errors` / `run_events`: structured failures and audit trail for reviewers.

Backfill sequence: create run → enqueue jobs → fetch or reuse raw page → store raw page → parse → upsert entities/media → enqueue discovered next page/thread jobs within caps → mark job complete → update run counters. Resume by selecting non-terminal jobs for the run; never require a clean restart after an interrupted capture.

## Shared Pipeline-Stage Status Vocabulary

Use one pipeline-stage status vocabulary across scraper, media worker, SQLite/Drizzle store, API, and UI. Do not invent component-local synonyms; if a row needs extra detail, keep the status stable and add a reason/detail column.

| Domain | Status | Meaning | Store owner |
|---|---|---|---|
| Raw/page lifecycle | `raw_fetched` | Public HTML or import payload is durably stored before parsing. | `raw_pages.fetch_status` or `raw_pages.lifecycle_status`; referenced by `capture_jobs.raw_page_id`. |
| Raw/page lifecycle | `parsed` | Parser produced structured tweet/user/media/thread/quote candidates from stored raw content. | `raw_pages.parse_status`, plus `parser_errors` on failure. |
| Entity lifecycle | `normalized` | Parsed candidates were upserted into canonical `archive_users`, `archive_tweets`, and `archive_media` rows. | `archive_tweets.lifecycle_status`, `archive_users.lifecycle_status`, `archive_media.lifecycle_status`, or a normalized event on the owning job. |
| Media lifecycle | `queued` | Stored remote media URL is eligible for download. | `archive_media.download_status`. |
| Media lifecycle | `downloading` | A media worker claimed the row. | `archive_media.download_status`, `download_attempts`, `download_started_at`. |
| Media lifecycle | `downloaded` | Local file exists and `localPath` is set; size/hash/content type should be stored when available. | `archive_media.download_status`, `local_path`, `local_size`, `local_hash`, `downloaded_at`. |
| Media lifecycle | `failed` | Download failed without policy skip; preserve error class/message and next retry decision. | `archive_media.download_status`, `last_error`, `attempts`. |
| Thread lifecycle | `pending` | Tweet references a thread/conversation not yet fetched or assembled. | `archive_tweets.thread_status` or `archive_threads.status`. |
| Thread lifecycle | `partial` | Some relationships are known, but caps/public HTML/import gaps prevent complete assembly. | `archive_tweets.thread_status` or `archive_threads.status`. |
| Thread lifecycle | `complete` | Known available thread relationships for the lane/import are assembled. | `archive_tweets.thread_status` or `archive_threads.status`. |
| Quote lifecycle | `pending` | Tweet appears to quote another tweet, but quoted tweet metadata is not resolved yet. | `archive_tweets.quote_status`, `quoted_tweet_id`, `quoted_url`. |
| Quote lifecycle | `resolved` | Quoted tweet id/author/text/media available from parsed or imported data. | `archive_tweets.quote_status` plus quoted fields/relationship row. |
| Quote lifecycle | `unavailable` | Quoted content is deleted, private, rate-limited, outside caps, or absent from public/import data. | `archive_tweets.quote_status`, `quote_unavailable_reason`. |
| Import provenance | `imported` | Row came from local/exported/public dataset material rather than a live public HTML fetch. | `provenance.capture_kind`, `source_lane`, `source_dataset`, `import_batch_id`. |
| Local annotations | `note`, `tag`, `mark` | User-created archive notes, attributes, and categorization marks for later pipeline triage; never emitted back to Twitter/X. | `tweet_annotations` or existing local `archive_notes`/`archive_labels` tables keyed by tweet id and annotation kind. |
| Skip reason | `skipped_policy` | Safety policy forbids capture or download. | `capture_jobs.skip_status`, `archive_media.skip_status`, or `run_events`. |
| Skip reason | `skipped_rate_limit` | Public endpoint reported rate limiting/WAF/CAPTCHA; stop rather than bypass. | `capture_jobs.skip_status`, `raw_pages.fetch_status`, `run_events`. |
| Skip reason | `skipped_private` | Target or referenced content is private/locked/login-only. | `capture_jobs.skip_status`, `archive_tweets.quote_status` with `quote_unavailable_reason`. |
| Skip reason | `skipped_deleted` | Public/import source indicates deleted or unavailable content. | `capture_jobs.skip_status`, `archive_tweets.quote_status` with `quote_unavailable_reason`. |

Statuses are deliberately narrow. Run/job execution still uses `backlog`, `ready`, `running`, `paused`, `blocked`, `failed`, `done`, and `skipped`; the detailed lifecycle fields above explain what data reached which boundary and why rows were skipped.

## SQLite and Drizzle Mapping

Arthur's decision is to move SQLite access to Drizzle now, while keeping SQLite as the durable database and avoiding a broad scraper/UI feature rewrite in the same change. The migration owner should map the current plain SQLite boundary into a Drizzle schema with boring text status columns and indexes:

- `archive_runs(status, lane, target, options_json, counters_json, last_error, started_at, finished_at)`.
- `capture_jobs(status, skip_status, lane, target, source_url, raw_page_id, attempts, priority, checkpoint_json, provenance_json)`.
- `archive_jobs(source_lane, target_type, target_value, priority, status, attempts, created_at, claimed_at, claimed_by, finished_at, options_json, provenance_json)` with indexes for pending queue polling and target lookup.
- `raw_pages(lifecycle_status or fetch_status, parse_status, source_url, source_lane, fetched_at, http_status, content_hash, body_path, parser_version, raw_cache_key, wayback_timestamp, wayback_original_url)`.
- `archive_tweets(lifecycle_status, thread_status, quote_status, quote_unavailable_reason, conversation_id, in_reply_to_tweet_id, quoted_tweet_id, quoted_url, quoted_author_handle, quoted_text, quoted_media_json, captured_metrics_json, provenance_json)`.
- `archive_media(download_status, skip_status, media_type, remote_url, local_path, local_size, local_hash, content_type, attempts, last_error, provenance_json)`.
- `social_graph_nodes(account_key, account_id, username, display_name, observed_at, provenance_json)` plus `social_graph_edges(source_account_key, target_account_key, relation, source_lane, observed_at, import_batch_id, import_status, provenance_json)` and `social_graph_import_batches(...)`.
- `import_batches(source_lane, source_dataset, source_url, imported_at, importer_version, counters_json, provenance_json)`.
- `tweet_annotations` or existing local notes/labels tables keyed by tweet id with `annotation_kind` (`note`, `tag`, `mark`), `value`, `created_at`, `updated_at`, and optional `source`/`author` for local tooling.
- `run_events` / `parser_errors` for audit detail, including `runId`, `jobId`, source URL, status transition, and structured error/provenance payloads.

Drizzle should mirror the status vocabulary as enum-like TypeScript constants over SQLite `text` columns, with check constraints where useful and indexes for queue polling (`capture_jobs(status, priority)`), media work (`archive_media(download_status)`), timeline rendering (`archive_tweets(author_id, created_at)`), metric/time filtering (`archive_tweets(created_at)` plus captured metric fields or generated columns), thread lookup (`conversation_id`, `thread_status`), quote lookup (`quoted_tweet_id`, `quote_status`), following graph lookup (`social_graph_edges(source_account_key, target_account_key, relation, observed_at)`), local categorization (`tweet_annotations(tweet_id, annotation_kind)`), and provenance (`source_lane`, `raw_cache_key`, `import_batch_id`). Keep the migration narrow: do not change capture semantics, status names, read-only metric payloads, local annotation meaning, or API payload meanings while moving the store boundary.

## Ask Arthur Before Broad Backfill

1. Should `@pleometric`, `@teortaxes`, and `@teortaxestex` be captured as separate profile runs, or should `@teortaxes` and `@teortaxestex` be linked as one logical corpus with shared reporting?
2. For quote tweets that are public but outside the current cap, should the archive enqueue a bounded quote-resolution job or mark `quote_status = unavailable` with reason `outside_cap` until a deliberate quote pass is requested?
3. What retention policy should apply to raw HTML bodies after normalization: keep indefinitely for reproducible parser fixes, keep only hashed/body-path payloads under a size cap, or allow per-run pruning after export?

## No-communication SQLite Polling Model

The scraper and API/UI are decoupled through SQLite, not direct process messaging:

- SQLite runs in WAL mode and is the durable handoff point for all live state.
- The writer scraper claims jobs and writes `run_events`, `raw_pages`, normalized `archive_*` entities, and `capture_jobs` / `archive_runs` state in small transactions.
- The backend/UI server opens read-mostly SQLite/Drizzle connections and polls derived views for active runs, queue state, parser errors, timeline rows, thread/quote detail, media rows, local annotations, statuses, and provenance.
- Correctness must not depend on scraper-server IPC, WebSocket commands, shared in-memory state, or an external queue. If the server restarts, it rebuilds UI state from SQLite.
- Browser clients must not read or write the live SQLite file directly while the scraper is writing. Serve JSON/HTTP and SSE from a tiny Bun layer over SQLite; a future offline export may copy the database or produce a sql.js/static bundle for read-only browsing.

## SQLite Viewing Instructions

- Normal review path: run `bun run dev` inside `packages/twitter-archive` and inspect the HTTP/SSE API plus static viewer backed by SQLite-derived views.
- The dev UI must not silently start network capture. Smoke/import commands populate SQLite; the viewer reads existing rows, jobs, events, provenance, quotes, media, and graph edges.
- For one-off inspection outside the UI, open a copied database file or an explicit read-only SQLite connection. Do not point browser code at the live SQLite file, and do not create a second store/export as the review source of truth.

## Local Feedback Loop and Markdown Export

- The dev UI local notes/tags/marks/attributes plus the authenticated capture clients — preferred Firefox WebExtension, Violentmonkey fallback, and the X bookmark DevTools extension — are inputs to the same local archive loop. All write through the localhost Bun server into SQLite, append JSONL events where useful, and generate derived Markdown; none of these paths writes to Twitter/X.
- Bookmark Markdown export defaults to `data/twitter-archive/markdown/bookmarks`. To move the export into Arthur's Obsidian vault, set `TWITTER_ARCHIVE_MARKDOWN_ROOT=/Users/arthur/vault/sources/clippings/twitter-bookmarks`; this writes files directly and does not launch or automate Obsidian.
- The default target should be the running dev server at `http://127.0.0.1:3420`, not the old unused ingest port. The Firefox WebExtension and Violentmonkey fallback start with lightweight visible-page payloads (`pageUrl`, `visibleTweets`, health ping), while `x-bookmark-sync-devtools` sends DevTools network snapshots. The local server or daemon normalizes all of them, owns persistence/queueing/Markdown export, and may later expose extension-facing RPC plus optional debugger/native-bridge helpers without replaying X private APIs.
- Browser-history ranking outputs are `data/twitter-archive/history-analysis.json` and `data/twitter-archive/history-analysis.csv`. Future agents resume by selecting bounded candidates, importing them into `archive_jobs`, and letting the worker claim jobs from SQLite; they should not treat history analysis as direct capture.

## Effect v4 Implementation Rules

- Model package capabilities as `Context.Service` services provided by `Layer`s: SQLite store, fetch/client, parser, clock/config, and JSONL logger boundaries.
- Keep `bun:sqlite`, filesystem, process args, HTTP/SSE, and network fetches behind boundary services; pure parsing and normalization stay dependency-injected.
- Decode untrusted inputs with `Schema` at external/process/file/API boundaries, including CLI args, JSONL rows, persisted SQLite payload blobs, imported files, fetched HTML metadata, and HTTP request/response bodies.
- Represent expected failures with `Schema.TaggedErrorClass` typed errors carrying source URL, run id, job id, and parser/store context where applicable; do not throw strings or collapse distinct failure causes.
- Use `Effect.fn` for reusable workflows such as enqueue, fetch/cache/parse/upsert, resume, import, and server handlers so tracing/error typing stays attached to the operation.
- Create `ManagedRuntime` only at command and server boundaries. Export libraries and services as `Effect` values/layers so tests, CLIs, and future server code compose the same implementation.

## Dev Runtime and Unified Logs

Target package-local command name: `bun run dev` in `packages/twitter-archive`. That command should be the single always-runnable Bun dev server for the tiny SQLite HTTP/SSE API plus static frontend/viewer; it must not require an active capture worker to render existing SQLite state.

All scraper, import, following-graph, media worker, server, and frontend/runtime events should append to one JSONL log stream with at least `component`, `runId`, `jobId` when available, timestamp, level, event name, and structured details. The UI polls SQLite for durable state and may tail or subscribe to the JSONL/SSE stream for recent operational messages; the database remains the source of truth.

Smoke capture remains an explicit networked archival action as `bun run smoke:nitter:communalai`; the dev UI should read existing state and expose controls/status without silently starting new network capture.

## Run/Job Execution Statuses

Use these execution statuses consistently in CLI output, store rows, and future UI boards. They are separate from the pipeline-stage fields above:

| Status | Meaning | Next action |
|---|---|---|
| `backlog` | Planned but not ready for execution. | Fill target/options or unblock dependency. |
| `ready` | Safe to run within policy and caps. | Worker may claim it. |
| `running` | Worker has claimed it. | Finish, pause, fail, or block with reason. |
| `paused` | User or policy stopped the run without data loss. | Resume explicitly. |
| `blocked` | Needs a technical or safety decision. | Record blocker; do not auto-retry. |
| `failed` | Exhausted retries or parser/store error. | Fix cause, then requeue deliberately. |
| `done` | The job reached its requested terminal boundary, such as raw fetched, parsed, normalized, or media downloaded. | No action unless reparse/backfill/download is requested. |
| `skipped` | Intentionally not captured under policy/caps/source availability. | Keep one of `skipped_policy`, `skipped_rate_limit`, `skipped_private`, or `skipped_deleted` as the audit reason. |

Future web control pane columns should group these statuses as a Kanban/progress board, while archive viewer columns show content lanes.

## Viewer and Control Pane Direction

Initial UI work follows `docs/plans/twitter-archive-ui-goal.md` (`copy-twitter-ui-ux-important-parts`). The target is a Twitter/Nitter-like single middle column for the important archive-reading parts, not a broad dashboard or full Twitter clone. Profile/timeline results for `@communalAI` or the selected target remain the primary viewport, with run progress available but visually secondary:

- one centered middle feed column with familiar tweet-card density, border rhythm, avatar/handle/time/metric hierarchy, inline media, and resolved quote cards
- compact sticky header for target/run summary; filters, sort, jobs/events/logs, provenance, and SQLite details are collapsed by default, `f` toggles the control drawer, and `/` expands controls and focuses search instead of letting controls take half the screen
- tweet author row with avatar, display name, `@handle`, timestamp/permalink context, and source/provenance affordance
- reply context as `Replying to @...`; replies are not grouped into the main thread unless stored relationships show a same-author/self-thread chain
- quote cards using resolved stored content; unavailable quotes keep visible status and reason instead of an unresolved-looking empty shell
- media/video grid using rounded Twitter/Nitter-like cards, sensible image aspect handling, compact multi-media layout, and inline video controls/posters when local or archived media data exists
- retweet/repost attribution rendered as read-only observed relationship, never as a repost action
- compact read-only metrics for reply/repost/like/view counts with metric/time sort and filters where data exists
- keyboard selection with `j`/`k`, local-only `y` copy-as-Markdown for the selected tweet or assembled self-thread, and local note/tag/mark categorization controls that write only to the archive database
- local Markdown export rooted at `data/twitter-archive/markdown/bookmarks` by default, with `TWITTER_ARCHIVE_MARKDOWN_ROOT=/Users/arthur/vault/sources/clippings/twitter-bookmarks` for direct filesystem export into Arthur's Obsidian vault

Explicitly exclude DMs, notifications, topics/trends, sidebars, recommendations, composers, account switching, and full Twitter interactions. CLI remains the first interface for smoke runs, imports, and reviewer-friendly diagnostics. The local dev UI stays on the TypeScript/Bun/Effect stack and should not introduce another UI runtime.

## Concrete Parallel Workstreams

| Workstream | First deliverable | Primary owner paths | Reviewer checks |
|---|---|---|---|
| `nitter-lane` | Nitter/public HTML fetch + parser for `@communalAI` smoke plus `@pleometric`, `@teortaxes`, and `@teortaxestex` backfill profile pages and tweet/thread URLs. | `packages/twitter-archive/src/**`, `packages/twitter-archive/test/**` | Low default caps, no X login/API usage, fixture coverage for parsed users/tweets/media/thread/quote data. |
| `quote-resolution` | Resolve quote references against stored/imported tweets and expose actual quoted author/text/media to API/UI when available. | `packages/twitter-archive/src/**`, `packages/twitter-archive/test/**` | Quote card renders stored content, not just id/url; unavailable quotes keep status/reason without bypass retries. |
| `sqlite-store` | Drizzle-backed SQLite boundary with raw page cache, resumable jobs, entity upserts, events, media local paths, status columns, provenance, import batches, following graph edges, and local annotations. | `packages/twitter-archive/src/**`, `packages/twitter-archive/test/**` | Resume from interrupted jobs; idempotent upserts; raw/import cache written before parse; SQLite polling views for UI; no status/API semantic changes during migration. |
| `cli-smoke` | Safe CLI command for `@communalAI` with `--max-pages` default `1`, plus explicit backfill target entrypoints for `@pleometric`, `@teortaxes`, and `@teortaxestex` after status fields are available. | `packages/twitter-archive/src/**`, package scripts only if needed | Explicit cap override, clear dry/smoke output, no project-wide side effects. |
| `dev-ui-api` | Always-runnable Bun dev server, HTTP/SSE API, and the focused `copy-twitter-ui-ux-important-parts` Twitter/Nitter middle-column local viewer over SQLite. | `packages/twitter-archive/src/**`, package scripts only if needed | Runs without live scraper; preserves `/api/state`, `/api/social-graph`, media-file route, note/attribute endpoints, shortcuts, and package tests conceptually; shows compact header, controls collapsed by default with `f` toggle and `/` search focus, tweet author rows, reply context, self-thread grouping, resolved quote content, rounded media/video grids, retweet attribution as relationship only, read-only metrics, metric/time sort/filter, `j`/`k` selection, `y` Markdown copy, local note/tag/mark controls, media status/local paths, provenance, jobs/events/logs. |
| `wayback-public-archives` | Internet Archive CDX/Wayback listing and import path for public Twitter/X snapshots into the same normalized records. | `packages/twitter-archive/src/**`, `packages/twitter-archive/test/**` | Bounded public archive queries; snapshot URL/timestamp/status preserved; no login replay or private API usage. |
| `browser-bookmark-import` | Local-only import helper for Chrome/Arc bookmark JSON and Firefox bookmark tables, producing profile/status/search scrape candidates plus skipped X-internal URLs with provenance. | `packages/twitter-archive/src/browser-bookmarks.ts`, docs, local `data/twitter-archive` reports | No browser profile mutation; no X authenticated bookmark scraping through profile files; `x.com/i/bookmarks` is handled only by the explicit DevTools extension/export lane. |
| `browser-history-queue` | Import ranked `history-analysis.json`/`.csv` candidates into SQLite `archive_jobs` for worker pickup. | `packages/twitter-archive/src/browser-history-queue.ts`, `data/twitter-archive/history-analysis.*`, docs | JSON/CSV are derived target rankings; queue rows preserve provenance; workers, not the analyzer, fetch/archive targets. |
| `firefox-webextension-capture` | Firefox-only WebExtension that temp-installs into the logged-in Firefox profile, extracts visible tweets/bookmarks/profile cards, and POSTs to localhost via a background script. | Planned `browser-extensions/extensions/twitter-archive-firefox/**`, `packages/twitter-archive/src/dev-ui-server.ts`, docs | Dev temp install goes through `about:debugging`; no cookie/token extraction, no X mutation, userscript-compatible ingest payloads first, and background messaging stays ready for future RPC/browser-control work. |
| `bookmark-extension-devtools-sync` | DevTools extension posts supervised X bookmark/network captures to the local dev server, which writes SQLite and Markdown. | `browser-extensions/extensions/x-bookmark-sync-devtools/**`, `packages/twitter-archive/src/dev-ui-server.ts`, Markdown export paths | Default endpoint is `http://127.0.0.1:3420`; remains a valid dedicated Chrome/Chromium/Helium capture lane; no cookies/tokens saved, no request replay, no X mutations, user controls open page and scrolling. |
| `markdown-export` | Persist bookmark/tweet Markdown files for review and later Obsidian use. | `packages/twitter-archive/src/**`, `data/twitter-archive/markdown/bookmarks`, docs | Default path is `data/twitter-archive/markdown/bookmarks`; override with `TWITTER_ARCHIVE_MARKDOWN_ROOT=/Users/arthur/vault/sources/clippings/twitter-bookmarks` for direct filesystem Obsidian export. |
| `following-graph-public` | Generic following edge capture/import from a supplied public Nitter following page handle or user-provided JSON/CSV export into shared SQLite graph tables. | `packages/twitter-archive/src/**`, `packages/twitter-archive/test/**` | Edge provenance and import batch status preserved; dev API exposes graph summary/top nodes/recent edges; no authenticated/private scraping; no Arthur-specific following scrape without a handle/export. |
| `media-downloads` | Low-concurrency media worker for archived remote image/video/GIF URLs. | `packages/twitter-archive/src/**`, `packages/twitter-archive/test/**` | Durable media directory; idempotent `localPath` updates; no duplicate files/rows on rerun. |
| `old-archives-datasets` | Import path for legacy/local archives into the same normalized records. | `packages/twitter-archive/src/import-legacy-sqlite.ts`, imports fixtures | Provenance preserved; no network dependency. |
| `viewer-control-pane` | Follow-on draggable multi-column viewer/control pane and deeper comments/replies explorer after the focused middle-column UI proves the data model. | Future package-local UI work after coordinator handoff | Starts from the Bun dev UI; roadmap supports draggable columns without making sidebars/full Twitter interactions/deep replies part of this pass. |
| `browser-capture` | Design-only until Nitter/store path is proven. | Future package-local adapter after approval | Main content/search/thread only; no credentials, DMs, notifications, bookmarks, topics, or private accounts. |
| `bookmark-extension-export` | Design-only authenticated X bookmark export/import contract. | Future browser-extension or import path after approval | User-installed/exported X bookmark contents only; no hidden API calls, credential handling, or automated bookmark scraping. |
| `emusks-research` | Notes on useful concepts and risks. | Docs only | No code import, execution, dependency, or private endpoint adoption. |

## V1 Acceptance Checklist

- `@communalAI` can be captured through the Nitter/public HTML lane at `--max-pages 1` by default; `@pleometric`, `@teortaxes`, and `@teortaxestex` are explicit backfill targets, not hidden defaults.
- Raw page cache and normalized SQLite records are written durably and can be resumed/upserted through the Drizzle-backed store boundary.
- CLI/library names make the read-only policy obvious and do not mention unsupported private API scraping.
- Reviewers can see run/job status, pipeline-stage status, source URL, and provenance for every stored record.
- Quote tweet rendering displays actual stored quoted content when available rather than only an id/url; unresolved/unavailable quotes keep visible status and reason.
- Wayback/public archive imports and following graph capture/import use the shared SQLite store with source/provenance metadata and no unsupported login/private API scraping.
- Browser bookmark imports are documented as a local file/SQLite candidate-target lane, while authenticated X capture follows an explicit helper hierarchy: Firefox WebExtension preferred, Violentmonkey visible-DOM fallback second, Chrome DevTools extension still valid for dedicated-profile network capture.
- Browser-history analysis outputs under `data/twitter-archive/history-analysis.json`/`.csv` can be turned into `archive_jobs`; normal workers claim those rows and record provenance.
- Authenticated capture helpers are documented with their API boundaries and install limits: the Firefox path uses temporary unsigned `about:debugging` install in normal Firefox, the userscript posts lightweight `pageUrl`/`visibleTweets` payloads plus health ping, the DevTools extension posts supervised network snapshots, and every lane posts only to localhost, saves no cookies/tokens, performs no mutations, and results in local SQLite/Markdown artifacts only.
- Markdown bookmark exports appear under `data/twitter-archive/markdown/bookmarks` by default or under `TWITTER_ARCHIVE_MARKDOWN_ROOT` when the user configures a direct Obsidian filesystem target.
- Dev UI can be started with `bun run dev` and can display SQLite-derived progress/tweets in a compact Twitter/Nitter-like middle column with compact header, controls collapsed by default (`f` toggles, `/` expands and focuses search), tweet author rows, `Replying to @...` context, self-thread-only grouping, resolved quote content, rounded media/video grids, observed retweet attribution with no repost action, read-only metrics, metric/time sort and filters, local-only `y` Markdown copy, `j`/`k` selection, local annotation controls, media/jobs/events/logs/provenance, and no live scraper requirement.
- Media downloads are bounded and idempotent, with local paths written back to SQLite.
- Unified JSONL logs include scraper, import, following-graph, media, server, and frontend events with component/run/job context.
