# @wirebabel/twitter-archive

TypeScript package for local-first Twitter/X archive capture and normalization.

Initial design lives in `../../docs/twitter-archive-plan.md`.

Capture scope for browser-based X/Twitter work: main content/tweet column plus search input only.

## Local imports and benchmarks

- `imports/` centralizes legacy tweet archive exports, downloaded Wayback indexes, and normalized JSONL snapshots.
- `legacy/tweet-archives-app/` preserves the useful source from the previous standalone tweet archive app/hydrator.
- `src/import-legacy-sqlite.ts` imports a legacy `tweets.db` into this package's JSONL entity layout.
- `../../scripts/eval-video-understanding.ts` benchmarks video-understanding providers over local videos with keyframe extraction, exact request caching, and provider error/cost logs. See `../../docs/research/video-understanding-provider-benchmark.md`.
