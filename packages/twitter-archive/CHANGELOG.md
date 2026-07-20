# Changelog

## 0.2.0
- Added durable public-account queue commands with normalized public X profile targets, explicit reset/status behavior tests, and operator documentation.

- Added tiered corpus/news account policy, durable day-spread scheduling, shared per-mirror token buckets, and idempotent `sync:tick`/`sync:daemon` entry points against the canonical archive SQLite.
- Consolidated availability feed storage so watcher SQLite retains only cursors/classification/delivery claims while tweet content remains in the canonical archive.
- Added queued `--exhaust` full-account sync with ordered handles, durable per-lane completion state, respectful mirror/cache backoff, yearly search-window and Wayback fallback lanes, capped media capture, and fixture-driven restart/idempotence coverage.
- Added a local Twitter/X corpus module with a forward-only SQLite schema, FTS5 tweet search, resumable cursors, respectful Nitter/fxtwitter capture, corpus CLI commands, and an in-memory store unit test.
- Added a reusable cached public-source adapter with RSS/Nitter/syndication/API fallback, normalized SQLite records, cadence and cursor state, agent search, manual import, and evidence-only list-tier analysis.
