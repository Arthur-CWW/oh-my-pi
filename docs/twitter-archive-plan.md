# Twitter/X Archive Plan

Goal: build a local-first inspiration archive for selected public X/Twitter accounts, starting with Pleometric, then use Gemini/Grok/Jimeng/frontend LLM workflows to understand and generate original shortform-video ideas.

## Principles

- TypeScript-first.
- Local-only archive by default.
- Respectful capture: low concurrency, jittered delays, bounded pagination, cache-before-fetch, and resumable jobs.
- Do not attempt to bypass auth, account challenges, private/locked accounts, deleted posts, or rate limits.
- Store raw captures separately from normalized entities so parsers can be improved without re-scraping.

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
- `packages/jimeng-client` — direct API helper ported from Slotok reverse engineering for capture-template dry-runs and carefully bounded live submit/poll/download runs

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
