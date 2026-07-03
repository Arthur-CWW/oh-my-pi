# Twitter/X Archive Plan

Goal: build a local-first inspiration archive for selected public X/Twitter accounts, starting with Pleometric, then use Gemini/Grok/Jimeng/frontend LLM workflows to understand and generate original shortform-video ideas.

## Principles

- TypeScript-first.
- Local-only archive by default.
- Respectful capture: low concurrency, jittered delays, bounded pagination, cache-before-fetch, and resumable jobs.
- Do not attempt to bypass auth, account challenges, private/locked accounts, deleted posts, or rate limits.
- Store raw captures separately from normalized entities so parsers can be improved without re-scraping.


## Account safety / ban avoidance

Arthur may use a logged-in X Pro account and Grok for research, but the scraper must behave like a conservative archiver, not an evasion bot.

Hard rules:

- Prefer official/exported APIs when they satisfy the job. Use browser capture only when official surfaces are unavailable or too limited.
- Use a dedicated browser profile for X research, preferably on Arthur's Framework laptop when we want headful/manual supervision. Do not touch DMs, notifications, settings, account/security pages, private/locked accounts, bookmarks, likes, follows, or unrelated recommendations.
- Read only public/authorized content visible to the logged-in user in the main timeline/search/tweet-detail column.
- Concurrency default: one browser tab, one navigation at a time, one media download at a time.
- Add jittered delays, bounded pagination, checkpointing, and cache-before-fetch. Never tight-loop scroll, search, or refresh.
- Stop immediately on login challenges, CAPTCHA, account-lock warnings, rate-limit banners, suspicious-activity notices, or repeated failed loads.
- Never bypass rate limits, authentication, paywalls, or platform controls. Never use stealth/browser-fingerprint evasion.
- Preserve provenance: original URL, author handle, tweet id, capture timestamp, query, and source mode.
- Store raw captures locally for parser improvement, but summarize/distill strategy mechanics rather than keeping large unnecessary dumps of social content.

Grok can be used directly in a logged-in `grok.com` headful browser as a research assistant over authorized X content. Prompt it for source discovery and thread candidates, then archive the underlying public tweet URLs and visible threads through the same safe capture queue. Treat Grok's summary as leads, not evidence; evidence is the captured source URLs.

## High-quality scraper architecture

The scraper should be package-local and boring:

1. **Planner** builds explicit capture jobs: profile timeline, search query, tweet detail/thread, media fetch.
2. **Policy gate** rejects private/locked/DM/bookmark/notification/settings URLs and blocks unsafe job kinds.
3. **Queue/limiter** runs at low concurrency with jitter, exponential backoff, and global stop conditions.
4. **Browser adapter** supports two modes: headful supervised Framework-laptop browser for Grok/X discovery, and dedicated logged-in CDP/CuaDriver profile for repeatable capture. Both read stable semantic surfaces (`main`, `article`, search textbox) and ignore sidebars/chrome.
5. **Extractor** converts visible tweet cards/thread pages into typed raw records with source snippets and provenance.
6. **Normalizer** deduplicates users/tweets/media/conversations by platform ids.
7. **Archive store** writes content-addressed raw captures, JSONL entities, media metadata, run logs, and parser errors.
8. **Reviewer loop** shows what was captured and why; a human can pause/kill/resume before more scrolling/searching.


Headful Framework-laptop mode is for quality and account safety, not speed: the queue should pause between jobs, expose the next URL/query before navigation, and let Arthur kill/resume without losing checkpoints.

For the trading strategy research lane, start with queries like:

- `from:macrocephalopod \"trend following\"`
- `from:macrocephalopod momentum OR trend OR turnover OR \"no trade\"`
- `from:therobotjames \"trend following\"`
- `from:therobotjames momentum OR turnover OR \"easy mode\"`
- `from:ScottPh77711570 macrocephalopod OR trend OR momentum`

Archive only the source tweets/threads needed to distill the strategy. The output should be a source-linked strategy brief, not a mirror of the accounts.

## X/Twitter frontend capture scope

When using a logged-in browser frontend, keep scraping narrow:

- Read the main content area only, e.g. primary timeline/search/tweet-detail column.
- Read the search input/search bar only for query entry and state.
- Ignore sidebars, trends, recommendations, messages, notifications, ads, and unrelated navigation.
- Prefer stable semantic/test attributes when available (`main`, `article`, search textbox) over brittle layout selectors.

This is enough for local search/archive workflows and reduces accidental capture of unrelated content.

## Archive semantics

Archive these as first-class entities:

- `User`
- `Tweet`
- `Media`
- `Conversation`
- `QuoteTweet` relation
- `Reply` relation
- `ArchiveRun`
- `Label` / `Note` / `Category`

Important behavior:

- If a tweet quotes another tweet, save and expand the quoted tweet.
- If the target account replies to someone, save the whole visible thread/conversation, not just the target account's tweet.
- Include all tweets in that thread that are visible to the logged-in user.
- Save media metadata and local media files when available.
- Deduplicate by platform tweet/user/media IDs.

## Local search operators

Implement a useful subset of Twitter search syntax locally:

- `from:pleometric`
- `to:someuser`
- `since:YYYY-MM-DD`
- `until:YYYY-MM-DD`
- `filter:media`
- `filter:videos`
- `filter:images`
- `filter:replies`
- `filter:quotes`
- full-text terms and quoted phrases
- later: `label:`, `category:`, `has:note`

## Storage/cache shape

Start simple and TS-native:

```txt
data/twitter-archive/
  raw/                 # content-addressed raw frontend/API captures
  media/               # downloaded images/videos
  entities/            # JSONL normalized users/tweets/media/conversations
  cache/               # request cache with TTL metadata
  indexes/             # generated full-text indexes
```

Cache requirements:

- content-addressed raw response cache
- TTL metadata per request/query
- per-entity dedupe
- retry with exponential backoff + jitter
- concurrency limit defaults: 1 browser tab, 1 media download, small queue

SQLite/FTS can come later if JSONL + generated search index becomes too slow.

## Viewer

`apps/tweet-viewer` should be a local web app with:

- search bar using the local operators above
- tweet detail/thread view
- quote tweet expansion
- media grid/video playback
- labels/notes/categories
- keyboard shortcuts inspired by Twitter:
  - `j` / `k` next/previous
  - `/` focus search
  - `enter` open selected tweet/thread
  - `o` open original URL
  - `v` focus/play video
  - `l` label/rate inspiration
  - `?` help

## Frontend LLM providers

Extend the existing `llm_frontend_browser` package/tool with provider adapters over dedicated CDP profiles:

- `chatgpt` — existing
- `aistudio` — existing
- `grok` — use X subscription frontend for X-aware search/summarization when useful
- `jimeng` — use frontend video generation subscription and download generated outputs
- `packages/jimeng-client` — direct API helper ported from Slotok reveng for capture-template dry-runs and carefully bounded live submit/poll/download runs

Keep provider automation background-safe. Never accept terms, solve CAPTCHA, or bypass account challenges automatically.

## Video understanding/generation pipeline

1. Archive tweets + media.
2. Extract candidate videos.
3. Use Gemini CLI/frontend models for video understanding:
   - hook
   - pacing
   - typography
   - visual layers
   - transitions
   - argument/joke structure
   - music/SFX
   - category/tags
4. Build an inspiration/style guide from high-level patterns.
5. Generate original scripts, storyboards, render specs, and asset prompts.
6. Use Jimeng/Gemini/Grok/other frontend tools for generation/review where useful.
