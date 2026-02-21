# Kagi Unofficial Client Handoff (Session Summary)

Date: 2026-02-21

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
```

---

## Important security note
- Local session file path: `packages/kagi/storage/session.json`
- Contains sensitive auth material; keep local-only and never commit/share.
