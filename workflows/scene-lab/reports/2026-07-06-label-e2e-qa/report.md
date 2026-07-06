---
title: LABEL view e2e QA — persist fix + autoplay verified
date: 2026-07-06
agent: LabelE2EQA + Fable
status: pass
---

## Verdict: PASS (all six items)

QA agent ran items 1–4 (hit its request cap mid-run); Fable executed the remainder on a fresh instance (port 4698, killed after). Arthur's live server untouched and healthy throughout.

| # | Check | Verdict | Evidence |
|---|---|---|---|
| 1 | Keypress `4` → green status → SQLite row | **PASS** | `01-happy-green-status.png`; row `2070323077087412226-1.mp4 / interesting / 04:13:20Z` matched UI toast "✓ saved 2:13:20 PM" (test row deleted after) |
| 2 | `interesting` group auto-seeded, key 4 | **PASS** | `/api/label-groups` → `{"name":"interesting","key":"4","ord":3}`; persists in groups table |
| 3 | Server down → visible failure, no fake green | **PASS** | `05-failure-red-verified.png`: `.label-save-status save-fail` "✗ 1 label save(s) failed: TypeError: Load failed" |
| 4 | Group creation (`:group`) persists | **PASS** (one flag) | `03-group-created.png`: `__qa__testgrp` listed at digit 5. FLAG: digit badge lacks the blue bound-key highlight groups 1–4 have — cosmetic, binding itself works |
| 5 | Autoplay + no grid rebuild on keynav | **PASS** | `p` → video `paused:false, muted:true`; 8 sentinel-marked cells all survive 2× `j` (focus moved mark 0→4 via class patch on stable DOM); ≤2 `<video>` elements at all times |
| 6 | Keymap overlay (`?`) | **PASS** (one flag) | `04-keymap-overlay.png`: `p` autoplay, `a/g` add group, `:group name` all listed. FLAG: overlay shows generic "1-9 assign" without per-group name bindings (names visible in sidebar) |

## Silent-loss guarantee

The original P0 (fire-and-forget `.catch(() => {})` + `loadData()` remount overwrite + unbound-digit no-op) is closed: failures now revert optimistic state, show red status, and beacon to `errors.log`. A user can no longer label into the void.

## Flags (cosmetic, not blocking)

1. New group's digit badge missing bound-key highlight styling.
2. Keymap overlay could list actual digit→group-name bindings.

## Repro

```bash
cd apps/scene-playground && bun src/server.ts --port 4698
# browser: LABEL → j/j → 4 → check labels.sqlite; kill server → 4 → red status
sqlite3 data/scene-lab/labels.sqlite "SELECT * FROM labels ORDER BY id DESC LIMIT 3"
```

Cleanup verified: `__qa__*` rows/groups removed, Fable's test label deleted (labels back to 5 pre-existing smoke rows), QA instances dead, live `/healthz` ok.
