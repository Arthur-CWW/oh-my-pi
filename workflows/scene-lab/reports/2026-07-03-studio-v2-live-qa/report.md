---
title: Studio v2 live QA
date: 2026-07-03
agent: StudioLiveQA
status: shipped
---

# Studio v2 live QA — port 4631

Live browser QA of the Studio Editor v2 (apps/scene-playground) against a private instance (`bun /tmp/studio-qa-boot.ts`, port 4631, private distDir `/tmp/studio-qa-dist`) driven via raw CDP against headless Chrome (port 9231). Arthur's 4600 pane was never touched. QA ran against a disposable spec copy `qa-studio-live.scene.json` (orbit-halo + one keyframes track), deleted after the run. Bundle caveat: the 4631 instance serves the bundle from its boot time; the studio tree was being concurrently patched (StudioEditor review fixes, LABEL view landing), so FAIL verdicts should be re-checked against the current bundle.

Result: **7 pass / 2 fail / 1 not-verifiable** (10/10 verdicts rendered).

| # | Check | Verdict | Note |
|---|-------|---------|------|
| 1 | Studio loads a spec, viewport shows content | PASS | Spec picked via tree dropdown; `canvas#scene` present, readout "147 / 299", runtime-state "runtime ready", canvas-clip PNG 225KB (well above blank-frame size). Shot: 01-studio-overview.png |
| 2 | Autoplay animates without manual toggle | PASS | transport-btn read "pause" (= playing) with zero transport interaction; canvas clips 1.5s apart differ (242,708B vs 202,993B) |
| 3 | Frame counter ticks during playback | PASS | `.frame-readout` "200 / 299" → "227 / 299" over 0.9s (~30fps) |
| 4 | Inspector position scrubber drag moves object live | FAIL | Position field found (X/Y/Z scrubs [0, 0, 0.25]); real CDP drag on X scrub (+120…140px, multi-step) produced NO value change before/mid/after drag and no canvas change. Identical drag mechanics DID work on bloom strength (check 5), so the scrub handler itself responds — the object-panel position row did not in this run. Hit-test isolation probe didn't complete (budget); could be overlap/stale-bundle — needs re-check. Shot: 02-inspector-mid-drag.png (taken mid-drag, shows no delta) |
| 5 | Pass param change → visible viewport change | PASS | Selected bloom pass row; CDP drag on strength scrub: 0.35 → 2 (clamped at max); paused canvas clip changed |
| 6 | Add text object → tree + viewport; x deletes | PASS | `.tree-plus` → "📝 Text" → new row `text-1` in tree; selected row + `x` key removed it. (Tree + delete verified directly; viewport appearance not separately isolated) |
| 7 | Timeline playhead moves; keyframe drag updates source | FAIL | Split: keyframe dot drag WORKS — t=5 keyframe dragged to t=5.567, value confirmed in Source tab JSON. But playhead is STATIC during playback: all 18 timeline svg line x1 values unchanged (playhead x1 stuck at 0) while frame readout advanced 18→48; reproduced twice. Timeline appears to only re-render on spec/selection changes, not per-frame. (Main notes this transport region regressed before and is being patched concurrently — re-QA after StudioEditor's fixes land) |
| 8 | Source tab round-trip + Save → GET /api/spec | PASS | Source tab pre edited (objects[0].opacity → 0.55) → Editor tab click re-parsed → inspector Opacity scrub shows "0.55" → Save button → GET /api/spec returns opacity 0.55. (First-pass "NO-FIELD" was a driver case-sensitivity artifact — labels are capitalized) |
| 9 | Vim keys work; suppressed while typing in CodeMirror | NOT-VERIFIABLE | Vim half PASSES: j persona-center→persona-halo, k back, Space toggles play/pause, ]/[ step frames (1→0 exact on [), ? opens keymap overlay (display:grid, full-window, "Keyboard Shortcuts…"; shot 03-keymap-overlay.png). CM-suppression half could not be tested: clicks never focused CodeMirror (in the decisive probe the still-open help overlay intercepted the click; earlier attempt suggests the editor pane may also have degenerate geometry in a 1000px-tall window). Side finding: **Escape does not close the help overlay** (hidden class/display unchanged after Escape; '?' is the toggle) |
| 10 | Provenance: UI save=human; file write=agent | PASS | After UI Save, newest /api/ledger row for the spec: actor=human. After `fs.appendFileSync` of "\n" to the spec file, within 2.5s newest row: actor=agent (ts 2026-07-03T13:29:30.129Z) |

## Screenshots

- `01-studio-overview.png` — studio view mid-autoplay: tree, viewport with rendered orbit-halo scene, inspector, timeline.
- `02-inspector-mid-drag.png` — captured mid-drag on the Position X scrub (documents the unresponsive drag of check 4).
- `03-keymap-overlay.png` — `?` keymap overlay open.

## Bugs / follow-ups

1. **Playhead static during playback** (check 7): timeline svg playhead never advances while frames tick. Real finding against the boot-time bundle; re-verify after StudioEditor's concurrent transport fixes.
2. **Position scrub drag unresponsive** (check 4): needs a hit-test isolation pass (bloom scrub responds to identical input; position row does not).
3. **Escape doesn't dismiss the `?` help overlay**; only `?` toggles it. If Escape-to-close is intended, it's missing.
4. CodeMirror pane focusability in a 1600×1000 window deserves a look (could not acquire focus by clicking; may be layout squeeze of `.source-wrap` under a long inspector panel, or the stuck overlay).

## Method notes

- node_repl sandbox had no filesystem or network access, and ncode lane 403'd; all live interaction ran through self-contained Bun CDP driver scripts (`/tmp/studio-qa-driver.ts`, `/tmp/studio-qa-probe.ts`) fired by Main, with progressive JSON results polled from disk.
- "Contentful viewport" uses a PNG-size heuristic (blank/solid frames compress to ~KBs; observed clips were 200KB+).
- Provenance ledger is shared with the live 4600 instance (both watch specs/); the agent-row test may have produced a duplicate row from the 4600 watcher — expected behavior, noted for ledger readers.

## Delta re-QA (same day, post-StudioEditor fixes)

Fresh instance on port 4632 (new bundle built at boot, private distDir `/tmp/studio-qa-dist2`), same CDP method, orbit-halo spec, non-mutating run.

| Item | Verdict | Evidence |
|------|---------|----------|
| Playhead moves during playback | PASS | Timeline svg line idx 17 (playhead) x1 310 → 370 over 1s while frame readout 155/299 → 185/299. Fixed. |
| Position scrubber drag changes value + canvas | FAIL | Position field found ([0, 0, 0.25]), `scrollIntoView` applied, then `document.elementFromPoint` at the X-scrub's own rect center returned **null** — the span is not hit-testable at its reported coordinates in a 1600×1000 headless window, so CDP pointer input never reaches the drag handler; values unchanged after +120px drag. (canvasChanged=true in the raw data is selection flash-overlay decay, not object movement.) Bloom-strength scrub in the short pass panel responds to identical input, so this is specific to the object panel's geometry — likely clipping/overflow of the inspector rail. Shot: 04-delta-mid-drag.png |
| Escape closes ? overlay | PASS | `?` → overlay `display:grid`, hidden=false; Escape → `hidden` class set, `display:none`. Fixed. |

## Delta re-QA 2: scrubber hit-test fix

Fresh instance on port 4633 (`PORT=4633 bun src/server.ts`, fresh bundle with the CSS fix: `.rail` overflow removed, `.inspector-wrap` min-width:0), headless Chrome CDP :9233, 1600×1000 viewport forced via `Emulation.setDeviceMetricsOverride`. First spec auto-loaded, object `plate-grid` selected in the tree. Two runs, identical outcome. Neither 4600 nor scene.localhost:1355 was touched; server + Chrome killed after each run.

| Check | Verdict | Evidence |
|-------|---------|----------|
| (a) Position X scrub hit-testable at its rect center | FAIL | `document.elementFromPoint` at the span's rect center → **null** (both runs). New diagnostic: the failure is NOT rail clipping of the span — the **entire `#inspector-container` renders at y = −428.5** (rect bottom 15.5, i.e. ~97% above the viewport top) in a correct 1600×1000 viewport (`innerHeight` 1000). The span sits ~107px below the container top (y −321), correctly placed *within* the container; the container itself is displaced above the screen. `scrollIntoView({block:'center'})` and manual `container.scrollTop` both leave scrollTop at 0 and move nothing. |
| (b) CDP drag changes displayed value | FAIL | mousedown + 3×mousemove (+40px each) + mouseup at the span's reported center (y ≈ −311): Position X displayed "0" before/mid/after (expected +1.2 at step 0.01/px). Consequence of (a): pointer coordinates above the viewport never reach the handler. |
| (c) Canvas re-renders from the drag | FAIL (not attributable) | Paused canvas clips before/after differ by only 3 bytes (387,066 vs 387,063) with the value unchanged — residual flash/animation decay, not object movement. No position change occurred, so no attributable re-render. |

**Conclusion: the overflow/min-width CSS fix is insufficient.** The original "rail clips the scrub spans" diagnosis was incomplete: with the fix in place the scrub geometry inside the inspector is fine, but the inspector's top rail row is displaced ~460px above the viewport (layout blow-out or phantom scroll of `.studio-view`/document at studio boot — bloom scrub in the shorter pass panel worked in earlier QA because that panel's fields land within the on-screen sliver). Follow-up probe staged at `/tmp/scrubfix-driver3.ts` (resets every scrolled ancestor to 0 before re-testing) — not yet run.

Screenshot: `05-scrubfix-mid-drag.png` (full viewport mid-drag, run 2). Raw data: `/tmp/scrubfix-result.json`, `/tmp/scrubfix-result2.json`; canvas clips `/tmp/scrubfix-canvas-{a,b}.png`.

## Delta re-QA 3: inspector scroll fix

Instance on port 4636 (`PORT=4636 bun --watch src/server.ts`), cmux split browser, default viewport 1206x993. First spec auto-loaded (`beat-grid.scene.json`), object `plate-grid` (24 clones, many fields) selected in tree.

### Root cause

Missing `</nav>` closing tag in the HTML template (`src/ui/main.ts` line 69). The `<nav class="topnav">` opened on line 65 was never closed before `<section id="reports-view">`. In HTML5, `<nav>` does NOT auto-close when the parser encounters `<section>`, `<div>`, or `<footer>` — all are valid flow content children. The browser nested **every sibling** (reports-view, studio-view, label-view, help-overlay, footer) inside the nav.

Since `.topnav` is styled `display: flex; height: 32px; align-items: center`, the 937px-tall `.studio-view` became a flex child centered in a 32px container: `top = (32 - 937) / 2 = -452.5`, placing the entire studio grid 453px above the viewport. `elementFromPoint` at the Position X scrub's rect center (y=-307) returned null because the element was physically above y=0. `scrollIntoView` was a no-op because the inspector-container's scroll chain was intact (height constrained at 440.5px, scrollHeight 844px, overflow-y: auto) — the content was scrollable, but the entire grid was displaced.

Previous hypotheses about `overflow: hidden` on `.inspector-wrap` or missing `min-height: 0` on grid children were incorrect — the scroll chain was never broken; the positioning was.

### Fix

One line: added `</nav>` after the last button in the topnav template, before `<section id="reports-view">`.

### Verdicts

| Check | Verdict | Evidence |
|-------|---------|----------|
| (a) Position X scrub visible (boundingRect.top >= 0) | PASS | `rect.top = 168.5` (was -316.5). `studio-view.rect.top = 32` (was -453), correctly below nav. |
| (b) `elementFromPoint(rect center)` === span | PASS | Returns `<span class="scrub-value">` with text "0". Hit-test confirmed. |
| (c) `scrollIntoView` works | PASS | Scrolled inspector-container to bottom (scrollTop=403), then `scrollIntoView({block:'center'})` on Position X span brought it back to scrollTop=0 with rect.top=168.5. |
| (d) CDP drag changes displayed value | PASS | `tab.drag` from Position X center +80px right: value "0" → "0.8". |
| (e) Canvas re-renders from the drag | PASS | Pre/post-drag screenshots differ (SHA1 `a261b2b7...` vs `4cc56ad6...`). Dirty dot appeared in source editor header. |
| (f) Source editor renders and scrolls | PASS | CodeMirror editor visible (rect.top=529.5, height=439.5), scrollable (scrollHeight > clientHeight). |
| (g) Timeline/viewport unaffected | PASS | Timeline SVG present (rect.top=829, height=140). Canvas visible (width=414.5, height=737). |
| (h) Typecheck + tests green | PASS | `bun run typecheck` clean, `bun test` 125 pass / 0 fail / 303 expect() calls. |

Screenshot: `inspector-scroll-fix-post-drag.png` — full studio after Position X drag to 0.8, showing correct layout with inspector, source editor, timeline, and viewport all visible.
