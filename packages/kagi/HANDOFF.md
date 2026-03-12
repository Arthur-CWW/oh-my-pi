# Kagi Unofficial Client Handoff (Session Summary)

## Update: 2026-03-11

### What changed this session

- Added package-owned Effect interface for Kagi search:
  - `packages/kagi/src/kagi-search-effect.ts`
  - exported `runKagiSocketSearchEffect(...)`
- Moved Kagi-specific error classification into package boundary (instead of Effect app entry/runtime branches):
  - `session-unavailable`, `unauthorized`, `forbidden`, `rate-limited`, `http-error`, `request-failed`
- Updated Effect adapter to consume package Effect interface:
  - `src/effect/kagi-search.ts`
- Added/updated tests:
  - `tests/kagi-search-package-effect.test.ts` (new package-level classification tests)
  - `tests/kagi-search-effect.test.ts` (deps now Effect-based)

### Next follow-up

- Continue converting remaining `packages/kagi/*` runtime interfaces to Effect-first style (search is done; advanced/rules paths still Promise-centric).

---

Date: 2026-02-23

## What was completed this session

### 1) Dynamic lens discovery (no longer static-only)
- Updated `packages/kagi/src/kagi-client.ts` to support dynamic lens resolution:
  - Added `discoverLenses(session, { query, includeFallback })`
  - Added `extractLensesFromHtml(html)` parser heuristics for:
    - search-page anchor links containing `l=<id>`
    - embedded JSON descriptors (`slug` + `id`)
  - Search path now attempts dynamic lens discovery before `/socket/search` when a named lens is used.
- Kept observed defaults as fallback merge (for resilience), but lens handling is now discovery-first.

### 2) Expanded advanced-search coverage + tests
- Extended `tests/kagi-client.test.ts` to cover:
  - full known advanced-search form payload mapping
  - default-empty behavior for omitted fields
  - `terms_appearing=any` normalization to empty form value
  - extended UI-discovered options (e.g. `region=be_fr`, `file_type=open_spreadsheet`)
- Added lens-specific tests:
  - dynamic lens extraction from HTML anchors
  - dynamic lens extraction from embedded JSON
  - dynamic lens-map usage in `buildSearchParams`

### 3) CLI improvements for lens work
- Updated `packages/kagi/scripts/kagi-lab.ts`:
  - new command: `lenses:list`
  - search flag support: `--discover-lenses` (default enabled)
  - search summary now includes lens/discovery metadata

### 4) Standalone package metadata under `packages/kagi`
- Added `packages/kagi/package.json` with local scripts:
  - `help`, `session:refresh`, `lenses:list`, `search`, `test`
- Added root convenience script:
  - `kagi:lenses:list`

### 5) Documentation updates in package scope
- Updated:
  - `packages/kagi/README.md`
  - `packages/kagi/notes/api-quirks.md`

### 6) Advanced-search browser parity probe (a11y + network)
- Added `packages/kagi/scripts/probe-advanced-search.ts`.
- Probe captures in a single run:
  - advanced modal accessibility subtree summary
  - actual POST payload to `/search/advanced`
  - redirect/response metadata
- Latest artifact:
  - `packages/kagi/output/network/capture-advanced-submit-filled.json`
- Key findings documented:
  - when `last_update` is set, date bounds can be omitted in submitted form/redirect
  - direct POSTs without `last_update` preserve `from_date`/`to_date`
  - Linux headless keyboard entry can corrupt date input values; probe now uses direct DOM value assignment for dates.

### 7) Effect integration: Kagi-first search provider
- Added `src/effect/kagi-search.ts` wrapper for Kagi search with:
  - lazy import (jiti-compatible extension loading)
  - SSE-tag parsing for real Kagi payloads (`top-content-unique`, `search`, `error`)
  - HTML extraction for titles/URLs/snippets from `search.payload.content`
  - option mapping (`lens`, `recencyFilter -> dr`, `domainFilter -> site:` clauses)
- Updated `src/effect/index.ts` so `web_search` now prefers Kagi by default and falls back to Gemini.
- In production cutover mode, Effect `web_search` is registered last to override legacy `web_search` while keeping the rest of the legacy tool surface.

---

## Scoped validation run during iteration

```bash
bun test tests/kagi-client.test.ts tests/kagi-log.test.ts
bun packages/kagi/scripts/kagi-lab.ts help
```

Result: pass.

---

## Remaining follow-ups

1) Lens parser robustness if Kagi search-page markup changes.
2) Full advanced-search e2e matrix sweep (regions/file-types/date windows).
3) Video-channel bulk UX hardening (dry-run + rollback/reporting).

---

## Resume commands

```bash
# refresh local Kagi session from open Chrome profile
bun packages/kagi/scripts/kagi-lab.ts session:refresh

# discover available lenses from current account/session
bun packages/kagi/scripts/kagi-lab.ts lenses:list --query "strict aliasing"

# run search with discovery-enabled lens resolution
bun packages/kagi/scripts/kagi-lab.ts search --query "C++ UB strict aliasing" --lens programming --discover-lenses 1

# test advanced redirect shape
bun packages/kagi/scripts/kagi-lab.ts advanced:redirect --site myanimelist.net --terms-appearing title --file-type pdf --last-update 3 --region us

# set/delete domain rule
bun packages/kagi/scripts/kagi-lab.ts rules:domain:set --domain github.com --kind 1
bun packages/kagi/scripts/kagi-lab.ts rules:domain:delete --domain github.com

# bulk domain rules
bun packages/kagi/scripts/kagi-lab.ts rules:domain:bulk --file domains.txt --kind -2

# set/delete video rule
bun packages/kagi/scripts/kagi-lab.ts rules:video:set --channel youtube.com/channel/UCSJ4gkVC6NrvII8umztf0Ow --creator-name "Lofi Girl" --kind -1
bun packages/kagi/scripts/kagi-lab.ts rules:video:delete --platform-id you_tube --creator-id UCSJ4gkVC6NrvII8umztf0Ow

# query captured network logs
bun packages/kagi/scripts/query-network-captures.ts --contains /esr/video_rules

# run advanced-search browser parity probe (a11y + submit capture)
bun packages/kagi/scripts/probe-advanced-search.ts
```

---

## Important security note
- Local session file path: `packages/kagi/storage/session.json`
- Contains sensitive auth material; keep local-only and never commit/share.
