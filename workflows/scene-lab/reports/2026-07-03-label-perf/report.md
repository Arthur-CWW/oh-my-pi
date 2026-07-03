# Label View Performance — 2026-07-03

## Summary

Rewrote the label grid renderer with three performance pillars:
1. **Incremental DOM updates** — j/k navigation touches 2-4 cells, never rebuilds
2. **Virtualization** — only visible + overscan rows exist in DOM (TanStack virtual-core)
3. **Media discipline** — max 2 `<video>` elements at any time

## Before (baseline: innerHTML rebuild)

| Metric | Value |
|--------|-------|
| DOM mutations per j/k press | ~N (all cells destroyed + recreated via `gridPane.innerHTML = cells`) |
| `<video>` elements in DOM | N + 1 (every cell + detail pane) |
| Rows rendered | All N/cols rows always in DOM |
| Perceived nav speed | Visible flash on each keypress |

## After (incremental + virtualized)

| Metric | Value |
|--------|-------|
| DOM mutations per j/k press | 4 (2 class toggles on old/new focus + 2 childList for video swap) |
| `<video>` elements in DOM | 2 (focused cell + detail pane) |
| Rows rendered | ~13 visible + overscan (vs full corpus) |
| Perceived nav speed | Instant — no visible flash |

### MutationObserver Evidence

Browser QA (port 4634), label view, MutationObserver on `.label-grid` with `{ childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }`:

```
Press j once:
  totalMutations: 4
  records:
    1. attributes  target="grid-cell"          (focus-lost: class removed)
    2. attributes  target="grid-cell focused"  (focus-gained: class added)
    3. childList   target="grid-cell"          (video element removed from old cell)
    4. childList   target="grid-cell focused"  (video element added to new cell)
```

Mutations are O(2 cells) per keypress, not O(n). The 4 records represent 2 class changes + 2 video element swaps (the media discipline moving the single grid video).

### Video Element Count

```js
document.querySelectorAll('video').length  // → 2
```

- 1 in focused grid cell (`.grid-thumb-video`)
- 1 in detail pane (`.detail-preview`)

All other cells render dark placeholders (`.grid-placeholder` with type/duration badges). Off-screen cells don't exist in DOM at all.

### Visual Verification

Screenshot: `label-view-after.png` in this directory.

- Navigation (j/k/h/l): cells retain stable DOM identity; only border-color + box-shadow change
- Focus glow transitions smoothly — no layout shift, no flash
- Hint strip visible at bottom with all shortcuts

## Architecture

### Files Changed

| File | Change |
|------|--------|
| `src/ui/label/view.ts` | Rewritten: virtualizer, incremental patches, placeholder cells, hint strip |
| `src/ui/label/view-model.ts` | New: pure `CellPatch` diff functions (focus, mark, visual, label, clear) |
| `package.json` | Added `@tanstack/virtual-core` dependency |
| `test/labels.test.ts` | Added 12 view-model patch tests (125 total, 0 fail) |

### Key Design Decisions

1. **Row-based virtualization**: `count = ceil(totalItems / cols)`, each virtual item = 1 grid row of `cols` cells
2. **Absolute positioning via `transform: translateY()`**: rows are `position: absolute; top: 0` with compositor-friendly transforms — no layout thrash
3. **`observeElementRect` + `observeElementOffset`**: TanStack's built-in helpers track the scroll container
4. **`scrollToFn: elementScroll`**: TanStack's element scroll helper
5. **No `measureElement`**: Row height computed analytically from container width, cols, and gap — no DOM measurement needed since all cells are square (`aspect-ratio: 1`)
6. **Scroll guard**: `scrollFocusIntoView` checks if the target row is already among `getVirtualItems()` before calling `scrollToIndex`, avoiding unnecessary scroll events

### Cell Patch Protocol

Pure functions in `view-model.ts` compute minimal CSS class diffs:
- `computeMovePatch(old, new)` → 2 patches: remove `focused` from old, add to new
- `computeMarkPatch(idx, wasMarked)` → 1 patch: add or remove `marked`
- `computeVisualPatch(oldAnchor, oldFocus, newAnchor, newFocus)` → set diff of visual ranges
- `computeClearPatch(anchor, focus, marks)` → bulk removal of `visual` + `marked` classes
- `computeLabelPatch(idx, hasLabels)` → 1 patch: `labeled` class toggle

`applyCellPatches()` only touches cells in `cellMap` (visible cells). Off-screen patches are dropped — cells get correct classes when they scroll into view via `createCell()`.

### Video Discipline

- All cells render `<div class="grid-placeholder">` with type badge + duration badge
- Only the focused cell gets a `<video>` element (positioned absolute over placeholder, `z-index: 1`)
- Focus move: `teardownFocusedVideo()` removes old video, `updateFocusedVideo()` creates new one
- Row scrolled out: video torn down if focused cell was in that row
- Detail pane: always has `<video>` for the focused item (second video)
- Real GIFs (`.gif` extension): no video element

### Hint Strip

Permanent compact bar at bottom of center pane:
`j k h l nav · v visual · space mark · 1-9 group · i inspect · u unlabel · / filter · ? help`

Styled with `--font-mono`, `--text-xs`, `--panel-bg`, `--panel-border-subtle`. kbd elements use `--panel-bg-active` + `--panel-border`. Always visible. Help overlay (`?`) still works.

## @tanstack/virtual-core Assessment

**Verdict: Earned pattern status.**

The vanilla adapter (`Virtualizer` + `observeElementRect` + `observeElementOffset` + `elementScroll`) worked cleanly for row-based grid virtualization. No fighting, no workarounds needed.

What worked well:
- `observeElementRect` uses `ResizeObserver({ box: 'border-box' })` — accurate, performant
- `observeElementOffset` uses passive scroll listener — no jank
- `elementScroll` handles scroll-to-index adjustments correctly
- `_didMount()` lifecycle is straightforward (returns cleanup function)
- `getVirtualItems()` returns `{ index, start, size, end }` — exactly what's needed for absolute positioning
- `scrollToIndex(row, { align: 'auto' })` handles scroll-to-focus cleanly

What could be better:
- No built-in grid/lanes support in core — had to virtualize rows, not individual cells
- Docs for the vanilla (non-React) adapter are sparse — had to read source for `observeElementRect`/`observeElementOffset` signatures
- `_willUpdate()` is needed before `getVirtualItems()` on initial render but calling it inside `onChange` can cause double-render — had to learn this from experimentation

Overall: solid, minimal, fast. Recommend for vanilla TS grid/list virtualization across the repo.
