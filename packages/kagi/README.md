# Kagi reverse-engineering lab (unofficial)

This folder is an isolated Kagi provider workspace.

## What is here

- `src/kagi-client.ts` — typed client primitives for:
  - session capture from your live Chrome (`:9222`)
  - `/socket/search` replay with browser-like headers/cookies
  - `/search/advanced` POST replay
  - domain/video personalization rule mutations (`/esr/*`)
- `src/kagi-log.ts` — run persistence + query/filter utilities
- `scripts/kagi-lab.ts` — CLI for fast experimentation
- `package.json` — local package metadata + convenience scripts for this workspace
- `vendor/browser_extensions/` — cloned `kagisearch/browser_extensions`
- `output/` — network captures, a11y snapshots, run artifacts
- `notes/api-quirks.md` — running reverse-engineering findings

---

## Quick start

1. Start Chrome with remote debugging (keep your logged-in profile):
   - `skills/pi-skills/browser-tools/browser-start.js --profile`
2. Refresh local session cache:
   - `bun packages/kagi/scripts/kagi-lab.ts session:refresh`
3. Discover available lenses for your current account/session:
   - `bun packages/kagi/scripts/kagi-lab.ts lenses:list --query "strict aliasing"`
4. Run a search capture:
   - `bun packages/kagi/scripts/kagi-lab.ts search --query "c++ strict aliasing UB examples" --lens programming --discover-lenses 1 --date-range 3`
5. List stored runs:
   - `bun packages/kagi/scripts/kagi-lab.ts runs:list --contains "c++"`

---

## Useful CLI examples

### Realtime + full SSE capture

```bash
bun packages/kagi/scripts/kagi-lab.ts search \
  --query "operator overloading pitfalls c++" \
  --lens programming \
  --date-range 4 \
  --region us \
  --out-dir packages/kagi/output/runs \
  --live-out packages/kagi/output/runs/live-cpp.sse.txt
```

### Lens discovery (dynamic)

```bash
bun packages/kagi/scripts/kagi-lab.ts lenses:list --query "c++ strict aliasing" --include-fallback 1
```

### Advanced-search redirect shape

```bash
bun packages/kagi/scripts/kagi-lab.ts advanced:redirect \
  --site myanimelist.net \
  --terms-appearing title \
  --file-type pdf \
  --last-update 3 \
  --region us
```

### Domain rules

```bash
bun packages/kagi/scripts/kagi-lab.ts rules:domain:set --domain github.com --kind 1
bun packages/kagi/scripts/kagi-lab.ts rules:domain:bulk --file domains.txt --kind -2
bun packages/kagi/scripts/kagi-lab.ts rules:domain:delete --domain github.com
```

### Video channel rules

```bash
bun packages/kagi/scripts/kagi-lab.ts rules:video:set \
  --channel youtube.com/channel/UCSJ4gkVC6NrvII8umztf0Ow \
  --creator-name "Lofi Girl" \
  --kind -1

bun packages/kagi/scripts/kagi-lab.ts rules:video:import --file channels.txt --kind -1

bun packages/kagi/scripts/kagi-lab.ts rules:video:delete \
  --platform-id you_tube \
  --creator-id UCSJ4gkVC6NrvII8umztf0Ow
```

### Accessibility tree snapshot

```bash
bun packages/kagi/scripts/kagi-lab.ts a11y:capture \
  --url https://kagi.com/settings/user_ranked?t=video \
  --out packages/kagi/output/a11y/user-ranked-video.json
```

### Query captured network artifacts

```bash
bun packages/kagi/scripts/query-network-captures.ts --contains /esr/video_rules
bun packages/kagi/scripts/query-network-captures.ts --contains /search/advanced --kind request
```

### Probe advanced-search browser parity (a11y + submit capture)

```bash
bun packages/kagi/scripts/probe-advanced-search.ts
```

---

## Notes

- Treat this as unofficial/reverse-engineered behavior.
- Be polite: rate limit your requests (CLI defaults include jitter).
- Session data is sensitive; `session.json` is written with mode `0600`.
- You can run package-local scripts directly via `packages/kagi/package.json` (for example: `bun --cwd packages/kagi run help`).
