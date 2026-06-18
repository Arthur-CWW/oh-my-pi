# Pleometric Tweet/Video Archive Plan

## Goal

Build a local-first archive of public Pleometric tweets and videos for inspiration analysis, search, and later workflow generation.

The archive should be respectful, resumable, and usable from a remote desktop over SSH/tmux.

## Owner paths

This lane may edit:

- `packages/twitter-archive/**`
- `apps/tweet-viewer/**`
- `docs/twitter-archive-plan.md`
- `docs/plans/pleometric-archive.md`

Runtime artifacts should stay ignored under:

- `data/twitter-archive/**`
- `data/coordination/pleometric-archive.status.md`

Do not edit `packages/jimeng-client/**`, TTS/lipsync docs, or pipeline schema docs without handoff.

## Respectful capture policy

- Archive public/unlocked content only.
- Do not attempt to bypass auth, account challenges, rate limits, private/locked accounts, or deleted content.
- Use low concurrency, jitter, cache-before-fetch, and resumable cursors.
- Separate raw captures from normalized entities.
- When using browser frontend scraping, inspect only:
  - main tweet/timeline/search column
  - search input when needed
- Ignore sidebars, trends, DMs, notifications, recommendations, and unrelated nav chrome.

## Capture phases

### Phase 0: Decide scope

Inputs needed from Arthur:

```txt
SSH host/alias:
Target handle(s): pleometric? variants?
Scope: tweets only / replies / quotes / media / likes?
Date range:
Use desktop browser cookies? yes/no
Preferred first tool: gallery-dl / yt-dlp / custom frontend capture?
```

Recommended initial scope:

```txt
from:pleometric filter:videos OR media timeline for @pleometric
Include original tweet text, media metadata, and downloaded video/image files.
Include replies/quotes only after first media pass succeeds.
```

### Phase 1: Quick media inventory

Try existing download tools first, because they are good at media URLs and resumability:

- `gallery-dl` for Twitter/X profiles/search, if configured
- `yt-dlp` for individual tweet/video URLs

Store under:

```txt
data/twitter-archive/pleometric/raw-tool-runs/
data/twitter-archive/pleometric/media/
data/twitter-archive/pleometric/download-archive.txt
```

Record commands and errors in:

```txt
data/coordination/pleometric-archive.status.md
```

### Phase 2: Normalized archive package

Implement/extend `packages/twitter-archive` with TS-native schemas:

```txt
packages/twitter-archive/src/
  schema.ts              # User/Tweet/Media/Conversation/ArchiveRun types
  paths.ts               # archive path helpers
  jsonl.ts               # append/read/dedupe JSONL helpers
  normalize.ts           # raw capture -> normalized entities
  cli.ts                 # future archive/search commands
```

Start JSONL-first, then add SQLite/FTS later if needed.

Suggested ignored runtime layout:

```txt
data/twitter-archive/pleometric/
  raw/
    frontend/
    tool-runs/
    api/
  entities/
    users.jsonl
    tweets.jsonl
    media.jsonl
    conversations.jsonl
    archive-runs.jsonl
  media/
    images/
    videos/
  indexes/
  cache/
  logs/
```

### Phase 3: Browser/frontend capture if needed

If tools cannot retrieve enough metadata/media:

- Use background browser/CDP or controlled frontend flow.
- Query/search only the target account/content.
- Persist raw response/capture records under `raw/frontend/`.
- Normalize into JSONL.
- Keep cookies/session data out of repo.

### Phase 4: Viewer/search

`apps/tweet-viewer` can remain skeletal until capture works. First viewer milestone:

- search bar with local operators
- media grid
- tweet/thread detail view
- open original URL
- labels/notes for inspiration mining

## Remote SSH/tmux pattern

On the remote desktop/host:

```bash
cd /Users/arthur/agents/web-access
export CLAUDE_TMUX_SOCKET_DIR="${TMPDIR:-/tmp}/claude-tmux-sockets"
mkdir -p "$CLAUDE_TMUX_SOCKET_DIR"
export SOCKET="$CLAUDE_TMUX_SOCKET_DIR/claude.sock"
tmux -S "$SOCKET" new -d -s pleometric-archive -n archive 'cd /Users/arthur/agents/web-access && exec bash'
```

Monitor:

```bash
tmux -S "$SOCKET" attach -t pleometric-archive
# or capture once:
tmux -S "$SOCKET" capture-pane -p -J -t pleometric-archive:0.0 -S -200
```

For long-running downloads, prefer resumable commands with explicit output dirs and logs:

```bash
mkdir -p data/twitter-archive/pleometric/logs
# Example placeholder; fill after confirming tool/cookie availability.
# gallery-dl --cookies-from-browser chrome --download-archive data/twitter-archive/pleometric/download-archive.txt \
#   --directory data/twitter-archive/pleometric/media 'https://x.com/pleometric/media' \
#   2>&1 | tee -a data/twitter-archive/pleometric/logs/gallery-dl.log
```

## Collision avoidance with other lanes

- This lane can define archive JSONL schemas independently.
- It should not define video pipeline recipe schema; instead, expose archive query outputs that the serialization lane can reference later.
- If the viewer needs pipeline artifacts, wait for the serialization lane to stabilize artifact URI conventions.

## First useful output

The first useful deliverable is not a perfect scraper. It is:

```txt
data/twitter-archive/pleometric/entities/tweets.jsonl
data/twitter-archive/pleometric/entities/media.jsonl
data/twitter-archive/pleometric/media/videos/*
data/coordination/pleometric-archive.status.md
```

With enough metadata to answer:

- Which Pleometric videos exist locally?
- What tweet text/context belongs to each video?
- Which clips are good candidates for Gemini analysis?
- Which visual/pacing tropes should inspire original work?

## Handoff prompt for a worker agent

```txt
You are the Pleometric archive lane in /Users/arthur/agents/web-access.
Read docs/plans/README.md, docs/plans/pleometric-archive.md, and docs/twitter-archive-plan.md.
Only edit packages/twitter-archive/**, apps/tweet-viewer/**, docs/twitter-archive-plan.md, and docs/plans/pleometric-archive.md unless explicitly handed off.
Write raw/downloaded artifacts only under ignored data/twitter-archive/** and status notes under data/coordination/pleometric-archive.status.md.
First determine tool availability for gallery-dl/yt-dlp and the exact SSH/cookie setup. Use low concurrency, resumable downloads, and do not bypass auth/rate limits.
```
