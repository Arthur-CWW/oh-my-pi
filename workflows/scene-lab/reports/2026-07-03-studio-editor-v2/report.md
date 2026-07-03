title: Studio Editor v2
date: 2026-07-03
agent: StudioEditor
status: shipped

## What Changed

Rebuilt the STUDIO view from a minimal three-column viewer into a four-region editor inspired by Roblox Studio / Unity, with Bret-Victor immediacy: every control change reflects in the live viewport instantly via a debounced (~150ms) re-init pipeline.

### Architecture

**Four-region layout** (3-column CSS grid):
1. **Scene tree (left, 220px)**: hierarchical list — spec selector dropdown, Camera, Timeline, Audio, Objects (kind icon + id + clone badge x12), Post stack (with up/down reorder), collapsible Assets browser (filesystem assets from /api/assets, double-click to insert as plane object). Add (+) menus for objects and passes. Delete via x button or keyboard.
2. **Inspector (right top, 320px)**: typed controls driven by tree selection. Number scrubbers with drag-to-adjust (Shift=fine, Alt=ultra-fine), keyboard j/k increment. Dropdowns for enums. Color inputs. Per-track editors (keyframes table with add/remove, osc fields, beat fields). Pass param sliders with live value labels. Clone group controls (count 1-64, layout grid/orbit/spiral/line/scatter, spacing, radius, stagger, seed reroll). Camera fov/position/lookAt. Timeline bpm + beats textarea. Audio asset picker.
3. **Viewport (center)**: canvas with transport bar (play/pause, frame scrubber, beat flash, frame readout with RAF-based live counter, resolution badge). Outline flash on object selection.
4. **Timeline strip (bottom 140px)**: SVG horizontal lanes per object with tracks, beat-grid ticks from bpm, colored track spans (position=cyan, rotation=amber, scale=green, opacity=red), draggable keyframe dots, playhead line synced to transport, click-to-seek, auto-scroll.

**Source tab**: CodeMirror JSON editor as Editor/Source toggle below inspector. Two-way sync — inspector edits update source on reinit, source tab parse updates spec. Dirty dot shows unsaved changes. Save button PUTs to /api/spec.

**Vim keymap module** (pure, tested): j/k tree navigation, g/G first/last, Enter focus inspector, Esc back to tree, Space play/pause, [/] frame step (Shift=beat jump), x/Delete remove, ? help overlay.

**State module** (pure, no DOM): in-place spec mutations (setObjectProp, addObject, removeObject, addPass, removePass, movePass, addTrack, removeTrack, setTrackProp, addKeyframe, removeKeyframe, moveKeyframe, rerollSeed, setCloneProp, setCameraProp, setTimelineProp, setAudioProp, setPassParam), debounce queue, selection model (discriminated union), parse/serialize, rewriteAssetsForPreview.

### Module decomposition

| Module | Purpose |
|--------|---------|
| `studio/state.ts` | Pure view-model: types, mutations, debounce, serialization |
| `studio/tree.ts` | Scene tree with spec selector, add/remove, reorder |
| `studio/inspector.ts` | Typed controls, singleton drag state (no listener leaks) |
| `studio/viewport.ts` | Canvas host, RAF frame counter, beat flash, transport |
| `studio/timeline.ts` | SVG lanes, beat grid, draggable keyframes, playhead |
| `studio/source.ts` | CodeMirror Editor/Source toggle, dirty tracking |
| `studio/keymap.ts` | Pure vim keymap with help text |
| `tokens.css` | 62 design tokens from Open Design dark mode |

### Design system

All CSS uses design tokens from `tokens.css` (extracted from Open Design dark mode by OpenDesignLanguage agent): `--canvas`, `--panel-bg`, `--accent`, `--text-primary`, `--space-*`, `--radius-*`, `--dur-*`, etc. Swap the token file to retheme the entire editor.

## Screenshots

- `studio-overview.png` — Full studio with tree, viewport, timeline, source editor
- `inspector-with-controls.png` — Object selected, inspector showing typed controls
- `inspector-object.png` — Alternative angle

## Verification

- `bun run typecheck` — green (0 errors)
- `bun test` — 109 tests pass across 4 files
- Server booted on port 4620, orbit-halo spec loaded
- Tree shows objects (persona-center, persona-halo x12) and passes (bloom)
- Inspector shows typed controls for selected object
- Timeline shows lanes with beat grid and playhead
- Source tab shows CodeMirror with spec JSON
- Reports view preserved and functional

## Post-review fixes applied

1. **BLOCKER** Markdown link XSS — href protocol whitelist (http/https/relative/# only) + attribute re-escaping via escapeHtml
2. **MAJOR** Schema-aware clamps in setSceneProp — rejects negative/zero/NaN width/height/fps/duration, clamps to valid ranges
3. **MAJOR** Reinit generation guard — monotonic counter prevents stale SceneRuntime.init from applying side effects
4. **minor** moveKeyframe now stable-sorts keyframes by t after drag
5. **minor** Runtime stop + viewport destroy on view switch away from studio
6. **minor** Keyboard scrub multipliers aligned with drag semantics (Shift=0.1x fine, Alt=0.01x ultra-fine)
7. **minor** body user-select:none during active scrub drag

## Known Gaps

1. **Outline flash is approximate** — overlay flashes entire viewport, not per-object bounds (accurate bounds would require runtime API changes, which is a non-goal)
2. **No undo stack** — deferred to v3 per spec
3. **No in-canvas gizmos** — non-goal
4. **Inspector re-renders fully on each mutation** — acceptable for current object counts; could optimize with targeted DOM updates if specs grow large
