---
title: Pleometric corpus 35 → 82 items (429 wall pushed back)
date: 2026-07-04
agent: Fable
status: shipped
---

## Summary

Resumed the bounded public backfill past yesterday's 429 wall: **+47 new video items** (35 → 82 of the 150 cap), date range now Apr 30 – Jun 28, 2026. All 82 are live in the LABEL view (corpus API confirms 82).

![contact sheet](pleometric-contact-sheet.png)

## What changed under the hood

`scripts/pleometric-media-sync.boundary.ts` is now resumable and multi-handle:

- `--handle <h>` (default `pleometric`) — leads.json accounts can be mined the same way.
- True resume: existing manifest seeds the skip-set; already-downloaded items are never re-fetched.
- Crash/wall safety: manifest written incrementally after every new item; explicit no-shrink guard.
- `--max-items` is the total corpus cap after merge.

## This run

- 11 pages fetched, stopped at `wall-429` (fresh wall, later cursor than yesterday's).
- Full details: [`sync-summary.json`](sync-summary.json).

## Rerun (next later window — safe to repeat anytime)

```bash
bun scripts/pleometric-media-sync.boundary.ts --max-items 150 --max-pages 25
```

~68 items remain to reach the cap. Same command; walls lose nothing.
