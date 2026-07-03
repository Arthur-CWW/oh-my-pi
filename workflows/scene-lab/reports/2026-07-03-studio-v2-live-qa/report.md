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
