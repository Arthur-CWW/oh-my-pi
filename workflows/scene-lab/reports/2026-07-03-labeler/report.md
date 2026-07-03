---
title: LABEL view — yazi-style corpus labeler
date: 2026-07-03
agent: CorpusLabeler
status: shipped
---

## Summary

Built a three-pane LABEL view into apps/scene-playground for rapid vim-native media labeling of the Pleometric corpus. The core interaction loop — `j j v j j 3` — labels batches of items into groups with zero mouse interaction.

## Files added/changed

| File | Change |
|------|--------|
| `src/labels.ts` | SQLite labels store (groups + labels tables, CRUD, counts) |
| `src/ui/label/keymap.ts` | Pure vim keymap: grid nav, visual mode, digit assign, filter, sort |
| `src/ui/label/view.ts` | Three-pane UI: groups list, media grid, detail pane + CSS |
| `src/ui/main.ts` | Wired LABEL nav button, view switching, keydown routing, CSS injection |
| `src/server.ts` | Added label routes, corpus API, inspiration asset root, labels.close() |
| `test/labels.test.ts` | 36 tests: store CRUD, keymap pure logic, route guards, provenance |

## Verification

### Typecheck + tests
```
bun run typecheck  → clean
bun test           → 109 pass, 0 fail (all 4 test files)
```

### Live verification on port 4640
- **Grid renders**: 35 corpus items in responsive grid, focused cell has bright accent border
- **Video playback**: Focused cell video plays (muted, loop); confirmed `paused === false`
- **Core loop**: `j j v j j 3` labeled 5 items into "rhythm" group, focus auto-advanced to next unlabeled
- **Status line**: Shows `5/35 labeled  sort:unlabeled-first`
- **API verification**:
  - `/api/labels` → 5 label rows
  - `/api/label-groups` → rhythm count=5
  - `/api/corpus` → 5 items with labels array populated
  - `/api/ledger` → 5 human provenance rows with correct paths
- **Help overlay**: `?` shows full keymap reference
- **Route guard**: PUT with `../../etc/passwd` returns 403

### Screenshots
- `01-grid-focused.png` — Grid with focused cell, three-pane layout
- `02-visual-mode.png` — Visual mode active (VISUAL in status)
- `03-groups-with-counts.png` — After assigning (5/35 labeled)
- `04-keymap-overlay.png` — Keyboard shortcut overlay

## Gaps

1. **Video thumbnails appear dark** — Most Pleometric videos have black first frames; `preload=metadata` loads the poster frame which happens to be dark. Playback on focus works correctly. A future improvement could seek to 0.5s for poster generation.
2. **Group creation via `a` key** — Implemented and functional but not tested via browser automation (tested via API). The inline input appears, Enter confirms, Escape cancels.
3. **Filter by group click** — Clicking a group row in the left pane filters to that group; not screenshotted but functional.
4. **gg (double-g)** — Simplified to single `g` (consistent with existing studio keymap). True vim `gg` would require a key-sequence buffer.
