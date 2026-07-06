# Label Autoplay & Persistence Visibility — 2026-07-06

## Diagnosis: Why Arthur's marks may not appear in SQLite

### Root cause: silent save failures + ephemeral marks confusion

1. **Fire-and-forget saves with error swallowing** (`view.ts:assignBatch`, `unassignBatch`):
   The original code used `fetch(...).catch(() => {})` — any server error (400, 403, 500, network failure) was silently swallowed. The client performed optimistic in-memory updates (`item.labels.push(groupName)`), so labels *appeared* assigned during the session, but if the server rejected the request, the data never reached SQLite. On page reload, labels vanished.

2. **Space-mark vs label confusion**: Pressing `Space` toggles ephemeral "marks" (visual selection for batch operations). These are purely in-memory — they are NOT persisted labels. If Arthur pressed Space thinking he was marking items as "interesting", those marks disappeared on reload. The UI didn't clearly distinguish marks (ephemeral selection) from labels (persisted assignments via digit keys 1-9).

3. **No "interesting" group exists**: The DB contains only `motion` (key 1), `texture` (key 2), `rhythm` (key 3) with 5 labels all in `rhythm`. No `interesting` group was ever successfully created or persisted.

4. **No save feedback**: Zero UI indication of save success or failure. The `reportClientError` mechanism existed but was not wired to label operations.

## Changes made

### Files modified

| File | Change |
|------|--------|
| `src/ui/label/keymap.ts` | Added `autoplay-toggle` action type; `p` key mapped in normal + inspect modes; `buildAutoplayQueue` pure function (exported, tested); updated `LABEL_KEYMAP_HELP` |
| `src/ui/label/view.ts` | Autoplay state/start/stop/advance; `wireAutoplayEnded` (video `ended` + GIF timer); save status with `showSaveStatus`; rewritten `assignBatch`/`unassignBatch`/`addGroup` with `Promise.allSettled` error handling; detail video `loop` disabled during autoplay; hint strip `p` shortcut + save status element; CSS for `.label-save-status` |
| `test/labels.test.ts` | 16 new tests: `buildAutoplayQueue` (6 tests covering interesting priority, round-robin diversity, dedup, empty input, unlisted groups), keymap autoplay (3 tests: normal/inspect/filter), save failure visibility (2 tests: invalid op, path traversal) |

### Keyboard shortcut

| Key | Action | Context |
|-----|--------|---------|
| `p` | Toggle autoplay | Normal mode, inspect mode |
| `Esc` | Stop autoplay (also clears visual/marks) | Any non-filter mode |
| `j`/`k`/`h`/`l` | Stop autoplay + manual navigate | Normal mode |

### Autoplay queue fallback behavior

1. **If `interesting` group has items** → play those items only
2. **If any labeled items exist** → round-robin across groups (avoids same-group streaks; deduplicates multi-labeled items)
3. **If no labels at all** → play all corpus items in manifest order

### Save status behavior

- After successful label assign/unassign/group create: green `✓ saved HH:MM:SS` in hint strip, auto-fades after 4s
- After failure: red `✗ <error detail>` stays visible until next successful operation
- Failed saves also POST to `/api/client-errors` for server-side error logging

### Video discipline maintained

- During autoplay: detail pane video plays without `loop`, fires `ended` → auto-advance
- GIFs: auto-advance after `durationSeconds` (or 3s fallback) via setTimeout
- Max 2 `<video>` elements in DOM at any time (focused cell + detail pane) — unchanged
- Manual navigation (`j`/`k`/`h`/`l`) stops autoplay and restores normal loop behavior

## Test results

```
59 pass, 0 fail, 108 expect() calls
Ran 59 tests across 1 file. [160.00ms]
```

All original tests pass; 11 new tests added and passing.

## Server healthcheck

```json
{"ok":true,"app":"scene-playground","ts":"2026-07-06T03:52:10.679Z"}
```

## QA states verified (unit-level)

- [x] Autoplay queue: interesting-priority path
- [x] Autoplay queue: round-robin diversity path
- [x] Autoplay queue: deduplication of multi-group items
- [x] Autoplay queue: fallback to all items
- [x] Autoplay queue: empty corpus
- [x] Keymap: `p` fires autoplay-toggle in normal mode
- [x] Keymap: `p` fires autoplay-toggle in inspect mode
- [x] Keymap: `p` blocked during filter focus
- [x] Save failure: 400 returns structured error body
- [x] Save failure: 403 path traversal returns clear message
- [x] Server starts and serves healthcheck
