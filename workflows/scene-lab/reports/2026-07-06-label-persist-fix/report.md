---
title: Label Persistence Fix
date: 2026-07-06
agent: LabelPersistFix
status: complete
---

## Root Cause

**Primary**: `assignBatch` (view.ts, original line ~493) and `unassignBatch` (original line ~507) used fire-and-forget `fetch(...).catch(() => {})` — every network failure AND every non-2xx server response was silently swallowed. The user saw optimistic local state updates but zero feedback when persistence failed.

**Contributing factor**: `loadData()` is called on every `mountLabelView()` (triggered by `switchView` in main.ts:338). When Arthur switched views and came back, `loadData()` re-fetched the corpus from the server — overwriting the optimistic local labels with the actual (empty) server state. Labels appeared to "vanish."

**Group creation**: Arthur marked items as "interesting" but no such group existed in the DB (only motion/texture/rhythm with keys 1/2/3). The `addGroup` function (original line ~514) had no error UX — if group creation failed, the user saw nothing. And `groupForKey(action.key)` at line 371 returns null and silently `break`s when a digit has no bound group — another silent no-op.

## Fix Summary

### Error handling with optimistic revert (view.ts)
- `assignBatch`: saves label snapshots before mutation; on `Promise.allSettled` failure, reverts `item.labels` to snapshots and calls `showSaveStatus(false, ...)`.
- `unassignBatch`: same pattern — saves old labels, reverts on failure.
- `showSaveStatus`: on failure, calls the exported `reportClientError()` (with sendBeacon fallback and session cap) instead of a raw inline fetch, ensuring errors reach `data/scene-lab/errors.log`.

### Group creation flow (view.ts, keymap.ts)
- `g` key freed from "move to first item" (now `Home` only); `g` and `a` both open the group-add inline input via `promptAddGroup()`.
- `:` key opens a command-line input (`promptCommand()`) in the hint strip; accepts `:group <name>` to create a group and bind it to the next free digit.
- `interesting` group (key 4) is auto-seeded on first load if absent — `loadData()` checks `state.groups` after fetch and PUTs the group via `/api/label-groups` if missing.

### ResizeObserver log hygiene (error-report.ts)
- `window.addEventListener("error", ...)` now early-returns when `event.message` contains "ResizeObserver loop", filtering the benign noise before it hits the error log.
- `reportClientError` is now exported for use by other modules.

### Autoplay cleanup (view.ts)
- `unmountLabelView` now clears `autoplayActive`, `autoplayQueue`, `autoplayPosition`, `autoplayGifTimer`, and `saveStatusTimer` — prevents stale timers and state leaking across view switches.

### Help overlay (keymap.ts)
- Updated `LABEL_KEYMAP_HELP` with `a / g` (add group), `:group name` (create group by command), `Home / G` (first/last), `p` (autoplay).

## Autoplay Behavior

- `p` toggles autoplay mode (wired by LabelAutoplay sibling agent).
- Autoplay builds a priority queue: "interesting"-labeled items first, then round-robin across other groups, then unlabeled as fallback.
- Focused cell video plays muted; detail pane video plays muted without loop (advances on ended).
- j/k navigation stops autoplay. Grid is NOT rebuilt on navigation — CSS class patches on stable DOM cells, max 2 `<video>` elements in DOM at any time (focused cell + detail pane). No reload flashes.

## What Arthur Must Redo

His golden-seed labels from 2026-07-05/06 are lost — `labels.sqlite` has only the 5 smoke-test rows from 07-03. The labels were never persisted to the server. He must re-label the corpus items he previously marked. The `interesting` group (key 4) is now auto-seeded, so pressing `4` will assign items to it immediately.

## Files Changed

| File | Change |
|---|---|
| `src/ui/error-report.ts` | Export `reportClientError`; filter ResizeObserver noise |
| `src/ui/label/keymap.ts` | Free `g` key; update HELP entries |
| `src/ui/label/view.ts` | Import `reportClientError`; optimistic revert in assign/unassign; seed interesting group; `g`/`:` key handlers; `promptCommand()`; unmount cleanup; hint strip; command-input CSS |
| `test/labels.test.ts` | Tests for `g` key none-action, `Home` move-to-first, digit assign with visual range and single focus |

## QA Commands

```bash
# Run unit tests (140 pass)
cd apps/scene-playground && bun test

# Verify interesting group seeded (after server boot)
curl http://scene.localhost:1355/api/label-groups | jq '.[] | select(.name=="interesting")'

# Verify assign persists
curl -X PUT http://scene.localhost:1355/api/labels \
  -H 'content-type: application/json' \
  -d '{"mediaPath":"test.mp4","group":"interesting","op":"add"}'
# Then check DB:
sqlite3 data/scene-lab/labels.sqlite "SELECT * FROM labels WHERE grp='interesting'"

# Verify error logging on failure (kill server, press digit in UI, check):
# data/scene-lab/errors.log should show "Label persistence failure: ..."
```
