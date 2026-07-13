> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-04T06-00-08-576Z_019f2bb6-8080-7000-8a22-156408ea1a65/local/TwitterCorpus-report.md

# Twitter corpus implementation report

Implemented machinery for the local Twitter/X corpus under `packages/twitter-archive`.

Files changed:
- `packages/twitter-archive/corpus/accounts.json`
- `packages/twitter-archive/src/corpus/schema.ts`
- `packages/twitter-archive/src/corpus/store.ts`
- `packages/twitter-archive/src/corpus/scraper.ts`
- `packages/twitter-archive/src/corpus/cli.ts`
- `packages/twitter-archive/test/corpus-store.test.ts`
- `packages/twitter-archive/package.json`
- `packages/twitter-archive/CHANGELOG.md`

Design/invariants:
- Raw `bun:sqlite` corpus store, self-contained from the existing archive Drizzle/store stack.
- Forward-only schema versioning through `corpus_schema_version`.
- `tweets.id` remains a TEXT primary key; FTS5 uses a separate `tweet_id UNINDEXED` column and triggers to avoid rowid/text-id mismatch.
- Tweets are immutable once captured: `INSERT OR IGNORE` dedupes reruns without overwriting prior rows.
- Scraper is resumable by per-author cursor, uses one account/page flow at a time, URL-hash disk cache under `data/twitter-corpus/cache/`, per-request jitter, and mirror cooldown on rate limit.

Verification run by this agent:
- `cd packages/twitter-archive && bun test test/corpus-store.test.ts`
  - Result: pass. 1 test, 12 assertions.
  - Stderr included a non-fatal mise cache warning: `failed to write cache file ... Operation not permitted`.
- `cd packages/twitter-archive && bun run typecheck`
  - Result: exit 0.
  - Stderr included the same non-fatal mise cache warning, then `$ tsc --noEmit`.

Live smoke attempt:
- `cd packages/twitter-archive && bun run corpus:backfill --account voooooogel --max-pages 3`
  - Result: could not complete in this harness because the spawned Bun process could not create/open a file-backed sqlite database under `packages/twitter-archive/data/twitter-corpus` (`EPERM`/`SQLITE_CANTOPEN`, then readonly after placeholder creation). The in-memory store test and typecheck passed; parent should run the live smoke in a normal terminal.

Commands for full backfill and querying:
- Bounded smoke: `cd packages/twitter-archive && bun run corpus:backfill --account voooooogel --max-pages 3`
- Repeated/resumable sync: `cd packages/twitter-archive && bun run corpus:sync`
- Status: `cd packages/twitter-archive && bun run corpus:status`
- Search: `cd packages/twitter-archive && bun run corpus:search -- --q "frontier model" --author voooooogel`
