# vidIQ Replay Proxy

Local cache/replay proxy for vidIQ reverse-engineering experiments.

Run from the monorepo root:

```bash
pnpm proxy:vidiq
```

Modes:

- `VIDIQ_PROXY_MODE=proxy` fetches upstream and caches responses.
- `VIDIQ_PROXY_MODE=replay` only serves cached responses.
- `VIDIQ_PROXY_MODE=dummy` serves cached responses and falls back to empty JSON.

Targets use this URL shape:

```text
http://127.0.0.1:4873/https/api.vidiq.com/v2/...
http://127.0.0.1:4873/https/youtube-videos.vidiq.com/youtube/videos/...
```

Cache files are written under `reverse-engineering/vidiq-vision/captures/http-cache/`.
