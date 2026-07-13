# Twitter/X public sources and proposed lists

## Safety boundary

This subsystem reads and caches public data only. It does not sign in to X, read locked accounts or DMs, follow or unfollow accounts, create or edit lists, mute accounts, or publish content. Every account-changing action below is a proposal that requires a separate, explicit approval and an authenticated execution step outside the cache.

## Source order and cache

Use sources in this order when configured and publicly reachable:

1. Account RSS/Atom feed (including a configured public Nitter RSS endpoint).
2. Public Nitter HTML timeline.
3. Public syndication JSON.
4. An explicitly configured public/API endpoint.
5. Manual JSON import when public endpoints are unavailable.

The reusable implementation is `packages/twitter-archive/src/public-source.ts`. It normalizes `author`, `handle`, `id`, `timestamp`, `text`, `links`, and `sourceUrl` into a local SQLite cache. `(handle, id)` is the dedupe key. Each `(source, handle)` has a durable cursor and last-sync timestamp. Sync is sequential, uses bounded retry with backoff and jitter, and defaults to an hourly cadence; daily cadence is available. The default seed is `@thsottiaux`, augmented by a configurable followed-handle list.

Agent search accepts one handle, multiple handles (a proposed list), text query, start/end date, limit, and offset. Manual import accepts the same normalized fields as a JSON array or a `records`, `tweets`, `data`, or `items` collection.

## Evidence-based taxonomy

`public-source-cli.ts analyze` reports proposals only. Its tiers are deliberately explainable from cached evidence:

- **Primary** — sustained cached activity across multiple days with enough records to support a high-signal judgment.
- **Topic lists** — lower-volume accounts or accounts surfaced by a topic query. Name concrete topic lists only after reviewing matching cached records (for example, Agents, Model Systems, Design Tools, or Research).
- **Archive/mute candidates** — no cached evidence in the selected window. This means “review manually,” not “low quality”; endpoint gaps and a short observation window can produce the same result.

The report includes record count, active days, most recent timestamp, matching records, link count, and average text length. Rankings must cite those fields rather than intuition. Re-run with a representative date range and topic query before requesting changes.

## Commands

From `packages/twitter-archive`:

```bash
# Sync configured endpoints for the seed plus followed handles
bun src/public-source-cli.ts sync --db ./data/public-sources.sqlite --handles thsottiaux,other_handle --rss 'https://example.invalid/{handle}/rss'

# Search cached evidence
bun src/public-source-cli.ts search --db ./data/public-sources.sqlite --handles thsottiaux --query agents --since 2026-01-01

# Produce non-mutating tier proposals
bun src/public-source-cli.ts analyze --db ./data/public-sources.sqlite --handles thsottiaux,other_handle --query agents

# Endpoint-independent fallback
bun src/public-source-cli.ts import --db ./data/public-sources.sqlite --file ./public-export.json --source-url manual:approved-export
```

## Exact approval-gated actions

None of these actions may be inferred from an analysis report. Request approval with the exact handles and destination before doing any of the following:

1. **Create lists:** “Approve creating private/public X lists named `<exact names>`.”
2. **Add or move members:** “Approve adding `<handles>` to `<list>` and removing them from `<old list>`, if applicable.”
3. **Remove list members:** “Approve removing `<handles>` from `<list>`.”
4. **Follow or unfollow:** “Approve following/unfollowing `<handles>`.”
5. **Mute or unmute:** “Approve muting/unmuting `<handles>`.”
6. **Post or reply:** “Approve publishing this exact text from `<account>`.”

Approval for one action does not authorize another. A proposal must include the cache date range, source coverage/failures, and cited record IDs. Execution must return a dry-run diff first and then require a second explicit approval. This package intentionally provides no mutation implementation.
