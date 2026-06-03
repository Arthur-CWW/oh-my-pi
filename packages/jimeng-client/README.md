# @wirebabel/jimeng-client

TypeScript Jimeng/Dreamina direct-client helpers ported from the `slotok` `reverse-jimeng` branch (`3c9c803 refactor(provider): move jimeng direct runner into workspace package`).

This package contains only local client code and tests. It does **not** include captured cookies, raw network captures, or generated media.

## What was brought over

- Confirmed endpoint notes: `../../docs/provider/jimeng-direct-client-endpoints.md`
- SSE submit-id parsing
- Capture-template patching for:
  - image text prompts
  - video text prompts
  - first/last frame URI payload injection placeholders
- Direct submit/poll/download helpers
- Structured errors and risk-control detection (`ret=1019` / `shark not pass`)

## Risk controls

- Keep generation concurrency at `1`.
- Use bounded polling and stop on risk-control responses.
- Do not brute-force retries or spam repeated prompts.
- Refresh browser session/cookies explicitly when auth expires.

## CLI

```bash
bun run src/cli.ts -- \
  --op video \
  --capture data/jimeng-lab/raw/jimeng-network-capture-video-01.json \
  --session-bundle data/jimeng-lab/raw/session-bundle.json \
  --prompt "一只柴犬在海边冲浪，电影感，16:9" \
  --durationSec 3 \
  --dryRun
```

Use `--dryRun` first. Live runs can consume paid quota.
