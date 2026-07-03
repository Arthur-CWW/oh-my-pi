# Label View Performance — 2026-07-03

## Summary

Rewrote the label grid renderer with three performance pillars plus thumbnail imagery:
1. **Incremental DOM updates** — navigation touches exactly 2 cells, never rebuilds grid
2. **Virtualization** — only visible + overscan rows exist in DOM (@tanstack/virtual-core)
3. **Media discipline** — max 2 `<video>` elements at any time
4. **Thumbnail imagery** — ffmpeg-extracted frame thumbnails (cached, concurrency-limited)

## Before / After

| Metric | Before | After |
|--------|--------|-------|
| DOM mutations per j/k/h/l press | O(n) — `gridPane.innerHTML = cells` | **4** (2 class toggles + 2 video swap) |
| `<video>` elements in DOM | N + 1 (every cell + detail) | **2** (focused cell + detail pane) |
| Grid cells in DOM | All items (35+) | **18** (6 visible rows * 3 cols) |
| Cell imagery | Live `<video>` per cell | `<img>` thumbnail per cell |
| Navigation feel | Visible flash, page reload effect | Instant, no flash |
| Shortcut discoverability | Hidden (? overlay only) | Permanent hint strip at bottom |

## MutationObserver Evidence (port 4634, Chrome)

### Single j press (focus move down)

```
mutationsPerJ: 4
details:
  1. attributes  class  target="grid-cell"          (focused class REMOVED)
  2. attributes  class  target="grid-cell focused"  (focused class ADDED)
  3. childList   removed=1  target="grid-cell"      (<video> removed from old cell)
  4. childList   added=1    target="grid-cell focused" (<video> added to new cell)
```

### 5 consecutive k presses (focus move up)

```
totalMutations: 20
mutationsPerPress: 4.0
videoCount: 2 (unchanged throughout)
```

### 3 consecutive h/l presses (horizontal nav)

```
totalMutations: 12
mutationsPerPress: 4.0
videoCount: 2 (unchanged throughout)
```

**Conclusion:** Every navigation key produces exactly 4 DOM mutations — O(2 cells), not O(n).

## Video Element Count

```js
document.querySelectorAll('video').length  // → 2
```

Verified after j, k, h, l presses — always 2:
- 1 in focused grid cell (`.grid-thumb-video`, overlays thumbnail)
- 1 in detail pane (`.detail-preview`)

## Thumbnail Imagery

```
cells=18 videos=2 imgs=18 thumbsLoaded=18 rows=6 hint=true
```

All 18 visible cells show real ffmpeg-extracted thumbnails. Cold cache: ~4s (max 3 concurrent ffmpeg). Warm cache: instant (served from `data/scene-lab/thumbs/<sha1>.jpg` with `Cache-Control: public, max-age=86400, immutable`).

## Screenshots

- `label-final.png` — grid with real thumbnail imagery, hint strip, detail pane with video

## Architecture

### Files Changed

| File | Change |
|------|--------|
| `src/ui/label/view.ts` | Rewritten: TanStack virtualizer, incremental patches, thumbnail cells, hint strip |
| `src/ui/label/view-model.ts` | **New:** pure `CellPatch` diff functions (focus, mark, visual, label, clear) |
| `src/server.ts` | Added `/api/thumb` endpoint with ffmpeg frame extraction, SHA1 cache, concurrency limit |
| `package.json` | Added `@tanstack/virtual-core` dependency |
| `test/labels.test.ts` | 12 new view-model patch tests (125 total, all green) |

### Thumbnail Endpoint (`/api/thumb`)

- **Route:** `GET /api/thumb?path=<repo-relative media path>`
- **Guard:** Same streamRoots validation as `/asset`; only `.mp4` and `.gif` files
- **Cache:** `data/scene-lab/thumbs/<sha1(path)>.jpg`
- **Generation:** `ffmpeg -ss <10% duration or 0.5s> -i <file> -frames:v 1 -vf scale=360:-2 -q:v 5 <cache>.jpg`
- **Concurrency:** Max 3 ffmpeg at once; excess queued via promise queue
- **Dedup:** In-flight requests for same cache path share one promise
- **Headers:** `Cache-Control: public, max-age=86400, immutable`

### Cell Patch Protocol (view-model.ts)

Pure functions compute minimal CSS class diffs:
- `computeMovePatch(old, new)` → 2 patches
- `computeMarkPatch(idx, wasMarked)` → 1 patch
- `computeVisualPatch(oldAnchor, oldFocus, newAnchor, newFocus)` → set diff
- `computeClearPatch(anchor, focus, marks)` → bulk removal
- `computeLabelPatch(idx, hasLabels)` → 1 patch

### Video Discipline

- Non-focused cells: `<img>` thumbnail from `/api/thumb`, `loading="lazy"`
- Focused cell only: `<video>` overlaid at z-index 1, muted loop playsinline
- Focus move: tear down old `<video>`, create new
- Row scrolled out: `<video>` torn down if focused cell was in that row
- Detail pane: always `<video>` for focused item

### TanStack Virtual-Core

Row-based virtualizer: `count = ceil(totalItems / cols)`. Each virtual item = 1 grid row with `display: grid; grid-template-columns: repeat(cols, 1fr)`. Rows positioned with `transform: translateY()`. Row height computed analytically: `(width - padding - (cols-1)*gap) / cols`.

## @tanstack/virtual-core Assessment

**Verdict: Earned pattern status.**

The vanilla adapter (`Virtualizer` + `observeElementRect` + `observeElementOffset` + `elementScroll`) worked cleanly. No workarounds needed.

**Worked well:** ResizeObserver integration, passive scroll listener, scrollToIndex with auto-align, clean lifecycle (`_didMount` returns cleanup function).

**Notes:** No built-in grid support (row virtualization is fine). Vanilla docs sparse — read source for observer signatures. Recommend for vanilla TS grid/list virtualization across the repo.

## Acceptance

- [x] `bun run typecheck` — passes
- [x] `bun test` — 125 pass, 0 fail (12 new view-model patch tests)
- [x] DOM mutations per keypress — 4 (O(2 cells), not O(n))
- [x] Video elements — 2 at all times
- [x] Thumbnails — all visible cells show real imagery
- [x] No flash on navigation
- [x] Hint strip visible with all shortcuts
- [x] @tanstack/virtual-core assessment — earned pattern status
