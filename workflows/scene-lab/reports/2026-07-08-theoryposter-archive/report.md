---
title: "Theoryposter account archive pass — 2026-07-08"
date: 2026-07-08
agent: TheoryposterArchive
status: complete
---

# Summary

Archived the TEXT timelines of the six theoryposter accounts into the standard Twitter archive database (`data/twitter-archive/twitter-archive.sqlite`). All six handles now have more than 50 archived tweets, satisfying the acceptance threshold.

| Handle | Archived tweets (own) | Nitter pages fetched | Final stop reason | Notes |
| --- | --- | --- | --- | --- |
| @repligate | 65 | 8 | `run-once` | Rate-limited on first pass; succeeded on retry after backoff |
| @lumpenspace | 95 | 6 | `run-once` | Rate-limited on first pass; succeeded on retry after backoff |
| @teortaxesTex | 122 | 8 | `rate-limited` | Already above 50 after first pass |
| @tenobrus | 60 | 4 | `rate-limited` | Already above 50 after first pass |
| @tszzl | 60 | 7 | `run-once` | Rate-limited on first pass; succeeded on retry after backoff |
| @xenocosmography | 127 | 8 | `run-once` | Rate-limited on first pass; succeeded on retry after backoff |

## Walls hit

- All six handles hit a `rate-limited` wall on the first queued pass against `https://nitter.tiekoetter.com`.
- After a 2-minute backoff, the retry pass for `@repligate`, `@lumpenspace`, `@tszzl`, and `@xenocosmography` completed without further rate limits.
- `@teortaxesTex` and `@tenobrus` stayed at `rate-limited` from the first pass, but both already had >50 archived tweets.
- A quick probe of `nitter.poast.org` and `nitter.net` returned non-2xx / empty pages for these handles, so they were not used as viable mirrors. The failed probe rows were removed from `nitter_backfill_targets` to keep the queue clean.

## Resume command

To continue these six handles specifically from their saved cursors, run the queued worker after bumping them to the front of the due queue:

```bash
cd packages/twitter-archive
sqlite3 ../../data/twitter-archive/twitter-archive.sqlite \
  "UPDATE nitter_backfill_targets SET status='pending', updated_at='1970-01-01T00:00:00.000Z' WHERE handle_key IN ('repligate','lumpenspace','teortaxestex','tenobrus','tszzl','xenocosmography') AND base_url='https://nitter.tiekoetter.com';" \
  && bun src/queued-backfill-worker.ts --once --limit 6 --batch-pages 5
```

Equivalent direct backfill worker resume (no queue-priority manipulation needed):

```bash
cd packages/twitter-archive
bun src/backfill-worker.ts --batch-pages 5 --max-total-pages 5 repligate lumpenspace teortaxestex tenobrus tszzl xenocosmography
```

## Verification query

```sql
SELECT LOWER(username) AS handle, COUNT(*) AS tweet_count
FROM tweets
WHERE LOWER(username) IN ('repligate','lumpenspace','teortaxestex','tenobrus','tszzl','xenocosmography')
GROUP BY LOWER(username)
ORDER BY handle;
```

Result: all six handles returned >50 tweets (counts shown in the table above). Counts reflect the `username` column, i.e. tweets authored by each handle (retweets are attributed to the original author in this schema).
