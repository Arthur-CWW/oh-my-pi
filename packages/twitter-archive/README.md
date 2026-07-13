# @wirebabel/twitter-archive

TypeScript package for local-first Twitter/X archive capture and normalization.

Initial design lives in `../../docs/twitter-archive-plan.md`.

Capture scope for browser-based X/Twitter work: main content/tweet column plus search input only.

## Local imports and benchmarks

- `imports/` centralizes legacy tweet archive exports, downloaded Wayback indexes, and normalized JSONL snapshots.
- `legacy/tweet-archives-app/` preserves the useful source from the previous standalone tweet archive app/hydrator.
- `src/import-legacy-sqlite.ts` imports a legacy `tweets.db` into this package's JSONL entity layout.
- `../../scripts/eval-video-understanding.ts` benchmarks video-understanding providers over local videos with keyframe extraction, exact request caching, and provider error/cost logs. See `../../docs/research/video-understanding-provider-benchmark.md`.

## Tiered sync and store boundary

`corpus/accounts.json` is the single account policy. `tier: "corpus"` means exhaustive timeline, yearly search, Wayback, thread metadata, and media lanes. `tier: "news"` means one or more recent timeline pages on its cadence, with no thread enrichment or media download. The seeded corpus accounts include `pleometric`, `teortaxestex`, and the handles retained from the 2026-07-04 corpus design session; `thsottiaux` is intentionally news-only.

Tweet content has one canonical home: `data/twitter-archive/twitter-archive.sqlite` (or `TWITTER_ARCHIVE_DB`). The availability watcher does not retain feed bodies or tweet records in `.state/feeds.sqlite`; that database contains only adapter cursors, classifier cadence, and claim-before-delivery dedupe keys. Verbatim quotes in `docs/state/model-availability.md` are delivery output, not a second corpus. The earlier `src/corpus` prototype and its `data/twitter-corpus/corpus.sqlite` remain a legacy query/backfill surface and are not written by the tiered scheduler; migrating that legacy schema is a separate explicit migration.

The scheduler persists per-account due times and per-mirror token buckets in the canonical archive database. All account tiers share each mirror's bucket. Corpus refresh slots are distributed across the UTC day; news refreshes use its configured cadence. Claims, lane cursors, bucket balances, and entity upserts are durable, so repeated ticks resume instead of restarting.

```bash
# Idempotent automation entry: concise events and summary, exit 0 on success/no-op
bun run sync:tick

# Long-running local daemon; the same durable tick runs once per minute
bun run sync:daemon
```

The design preserves decisions mined from Arthur's prior sessions and `docs/state/twitter-source-and-lists.md`: public-only capture; RSS/Nitter/public endpoint fallback; `(handle, id)` entity dedupe; low concurrency with jitter, disk cache, mirror cooldown, and resumable cursors; exhaustive sync only for cared-about accounts; and no authenticated list/follow/post mutations without explicit approval. The 2026-07-13 completion session further fixed full-sync lane order as timeline → yearly search windows → Wayback → capped media, with completed reruns performing no network work.
