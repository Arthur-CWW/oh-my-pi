# Kagi Unofficial Client Handoff (Session Summary)

Date: 2026-02-20

## What was completed

### 1) Isolated Kagi workspace
- Created `packages/kagi/` as a standalone provider workspace.
- Cloned Kagi extension repo into:
  - `packages/kagi/vendor/browser_extensions`

### 2) Unofficial client implementation
- Added `packages/kagi/src/kagi-client.ts` with typed APIs for:
  - Chrome session capture + local secure cache (`session.json`)
  - Mimicked `/socket/search` fetch + SSE parsing + realtime chunk capture
  - `/search/advanced` POST replay and redirect capture
  - Domain rule APIs:
    - `/esr/user_rules`
    - `/esr/user_rules/delete`
    - `/esr/user_rules/bulk`
  - Video rule APIs:
    - `/esr/video_rules`
    - `/esr/video_rules/delete`

### 3) Artifact logging and querying
- Added `packages/kagi/src/kagi-log.ts` for run persistence and filtering.
- Added CLI:
  - `packages/kagi/scripts/kagi-lab.ts`
- Added network artifact query utility:
  - `packages/kagi/scripts/query-network-captures.ts`

### 4) Evidence captures
- Network captures saved in:
  - `packages/kagi/output/network/`
- Accessibility tree snapshots saved in:
  - `packages/kagi/output/a11y/`
- Search run outputs + raw SSE saved in:
  - `packages/kagi/output/runs/`

### 5) Tests
- Added:
  - `tests/kagi-client.test.ts`
  - `tests/kagi-log.test.ts`
- Scoped run used during iteration:
  - `bun test tests/kagi-client.test.ts tests/kagi-log.test.ts`

---

## What was tested with mimicked fetch requests

Yes, **mimicked fetch requests were used and validated** for these endpoint families:
- `/socket/search`
- `/search/advanced`
- `/esr/user_rules`, `/esr/user_rules/delete`, `/esr/user_rules/bulk`
- `/esr/video_rules`, `/esr/video_rules/delete`

Mimic included:
- browser-like headers (`user-agent`, `sec-ch-*`, `dnt`, referer)
- cookie header from captured Kagi cookies
- optional `x-kagi-authorization` session token

---

## Not finished / open items

1) **Lenses are likely not fixed**
- Current code uses static lens mapping observed in this session.
- Need follow-up: discover available lenses dynamically from current account/UI (or endpoint) instead of hardcoding.

2) **Advanced search coverage is not exhaustive**
- Implemented full payload shape and tested core fields.
- Not every field combination was exhaustively validated across multiple regions/file types/term modes.

3) **Video-channel bulk workflow polish**
- API calls work.
- Next pass should add more robust import UX (dry-run validation + rollback report + duplicate handling policy).

---

## Resume commands

```bash
# refresh local Kagi session from open Chrome profile
bun packages/kagi/scripts/kagi-lab.ts session:refresh

# run search with full capture
bun packages/kagi/scripts/kagi-lab.ts search --query "C++ UB strict aliasing" --lens programming

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
