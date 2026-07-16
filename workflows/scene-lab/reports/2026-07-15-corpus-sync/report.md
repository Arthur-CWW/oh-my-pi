---
title: Corpus sync — referential mirrors, bookmarks, and new handles
date: 2026-07-15
agent: CorpusSync
status: shipped
---

## Results

### 1. Referential-mirrors thread and media

- Main manifest item `2055420576714408309` exists at `data/inspiration/pleometric/2055420576714408309-1.mp4` and is playable: H.264/AAC, 1080×1920, 13.184 s (`ffprobe` passed).
- `resolveNitterTweetDetails` captured the public detail page at `https://nitter.tiekoetter.com/pleometric/status/2055420576714408309` and persisted 20 tweets in conversation `2055420576714408309` plus 3 media rows in `data/twitter-archive/twitter-archive.sqlite`.
- Convenience directory: `referential-mirrors/`. It contains the main video symlink, three downloaded thread images under `images/`, and `sources.md` with each local file, status URL, source URL, and status. No additional thread video was exposed by the public detail page.

### 2. Bookmarks

- Authenticated Chrome Default profile was available and showed the bookmarks timeline; no login/challenge handling was needed.
- Captured 135 visible bookmark tweet records and POSTed them to the local archive ingest endpoint. SQLite now has 153 rows with `source_lane='x-bookmark-sync-devtools'` (the 135 new records plus prior rows); ingest also enqueued 135 status jobs and wrote 136 Markdown bookmark files.
- Pending status jobs are intentionally retained for resumable public-detail enrichment; the bookmark tweet rows themselves are already landed in SQLite.

### 3. New handles

| Handle | Archive tweet rows | Capture result |
|---|---:|---|
| `medjedowo` | 26 | 2 timeline pages, 54 parsed tweets, stopped at safety page budget |
| `norvid_studies` | 29 | 2 timeline pages, 58 parsed tweets, stopped at safety page budget |

Both handles are present in `data/twitter-archive/twitter-archive.sqlite`; media lane was not entered because this bounded text-first pass used `--media-max-items 0`.

## Exact rerun/resume commands

### Referential thread

```bash
bun -e 'import { resolveNitterTweetDetails } from "./packages/twitter-archive/src/nitter.ts"; const r=await resolveNitterTweetDetails([{tweetId:"2055420576714408309",username:"pleometric"}],{dbPath:"data/twitter-archive/twitter-archive.sqlite",baseUrl:"https://nitter.tiekoetter.com",maxTweets:1,delayMs:1500,jitterMs:1500}); console.log(JSON.stringify(r,null,2));'
```

After the detail command, the exact archive media-pipeline rerun is:

```bash
bun -e 'import { initTwitterArchiveSqliteStore, downloadArchivedMedia } from "./packages/twitter-archive/src/index.ts"; const ids=["2055427824903655917-media-1","2055594880429084698-media-1","2055664809165660650-media-1"]; const store=initTwitterArchiveSqliteStore("data/twitter-archive/twitter-archive.sqlite"); const items=ids.map(id=>store.getMedia(id)).filter(Boolean); store.listMedia=(()=>items) as typeof store.listMedia; const r=await downloadArchivedMedia({store,mediaRoot:"workflows/scene-lab/reports/2026-07-15-corpus-sync/referential-mirrors",maxItems:3,concurrency:1,runId:"2026-07-15-corpus-sync-referential-mirrors",logPath:"workflows/scene-lab/reports/2026-07-15-corpus-sync/media-download.jsonl"}); console.log(JSON.stringify(r,null,2)); store.close();'
```

### Bookmarks

Start the local server, open `https://x.com/i/bookmarks` in Arthur's authenticated Chrome profile, and run the package's existing userscript action **Twitter archive: sync visible tweets** while scrolling. For an already captured page payload in Chrome, the exact local POST used was:

```bash
osascript -e 'tell application "Google Chrome" to execute (tab id <BOOKMARK_TAB_ID> of window id <WINDOW_ID>) javascript "JSON.stringify(window.__bookmarkPayload)"' | python3 -c 'import sys,urllib.request; payload=sys.stdin.buffer.read(); req=urllib.request.Request("http://127.0.0.1:3420/api/x-bookmark-sync/ingest",data=payload,headers={"content-type":"application/json"},method="POST"); resp=urllib.request.urlopen(req,timeout=30); print(resp.status); print(resp.read().decode())'
```

### New handles

```bash
cd packages/twitter-archive
bun src/queued-backfill-worker.ts --exhaust --handle medjedowo --pages-per-pass 2 --db-path ../../data/twitter-archive/twitter-archive.sqlite --log-path ../../workflows/scene-lab/reports/2026-07-15-corpus-sync/medjedowo-worker.jsonl --media-root ../../data/twitter-archive/media --base-url https://nitter.tiekoetter.com --media-max-items 0
bun src/queued-backfill-worker.ts --exhaust --handle norvid_studies --pages-per-pass 2 --db-path ../../data/twitter-archive/twitter-archive.sqlite --log-path ../../workflows/scene-lab/reports/2026-07-15-corpus-sync/norvid_studies-worker.jsonl --media-root ../../data/twitter-archive/media --base-url https://nitter.tiekoetter.com --media-max-items 0
```

To resume each bounded wave, rerun the same command with a larger `--pages-per-pass`; durable full-sync cursors continue from the stored timeline lane state. Keep concurrency at 1 and stop on the second 429/rate-limit wall, preserving the worker log as the resume point.
