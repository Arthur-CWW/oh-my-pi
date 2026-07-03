---
title: Studio v2 code review
date: 2026-07-03
agent: StudioCodeReview
status: shipped
---

# Findings


## 1. state.ts debounce/apply + mutation invariants

- **major** `apps/scene-playground/src/ui/studio/state.ts:278` — `setObjectProp(spec, id, "size.0", -1)` (and `scale`, `opacity`, `kind`, `asset`) writes raw values through `setNested`, so callers outside the current inspector min/max controls can persist invalid geometry or unsupported enum/asset references; suggested fix: make state mutations schema-aware (clamp finite numeric ranges, validate enum values, normalize empty asset to `undefined`, and reject asset ids not present in `spec.assets`).
- **major** `apps/scene-playground/src/ui/studio/state.ts:352` — `setSceneProp(spec, "width", -10)` or `fps = 0/NaN` creates specs that later feed `SceneRuntime.init` dimensions/fps directly; suggested fix: centralize scene-level setters with finite positive clamps for width/height/fps/duration before serialization/reinit.
- **minor** `apps/scene-playground/src/ui/studio/state.ts:522` — dragging a keyframe only clamps `t` and leaves the `keyframes` array in prior index order, so moving keyframe 1 before keyframe 0 serializes unordered keyframes; suggested fix: after any `t` change, stable-sort the track's keyframes by `t` or make runtime interpolation order-independent.
- **major** `apps/scene-playground/src/ui/main.ts:119` — `reinitPipeline()` has no in-flight guard/version token, so edits faster than a slow `SceneRuntime.init()` can overlap and let an older init finish after a newer spec; suggested fix: serialize reinit requests with a monotonic generation and only apply canvas/render/start side effects for the latest generation.


## 2. ledger.ts + server ledger/SSE wiring

- **major** `apps/scene-playground/src/server.ts:367` — the per-path watcher debounce clears the prior timer, so two distinct agent writes to the same `.scene.json` inside 500ms produce one ledger row for only the final file contents; suggested fix: queue watcher events/content hashes per path and record each distinct hash, or reduce coalescing to SSE-only while keeping provenance append-only.
- **major** `apps/scene-playground/src/server.ts:373` — recent PUT suppression is time-only and checks `Date.now() - recentPut.ts < 3000`, so a delayed fs watcher callback at/after the gate records the human PUT content again as an agent edit; suggested fix: store the PUT content hash and suppress the matching watcher event regardless of elapsed time, then delete the suppression entry after a successful match or bounded TTL.
- **clean** `apps/scene-playground/src/ledger.ts:95` — SQL statements use `?` parameters for path, actor, hashes, and limits; I did not find path-string interpolation into SQL.
- **clean** `apps/scene-playground/src/server.ts:108` — PUT, watcher, list, and stats paths are normalized through `toRepoPath(repoRoot, absolutePath)` before ledger lookup/insert; no absolute-vs-relative mismatch found for normal in-repo paths.


## 3. main.ts + keymap.ts lifecycle/focus

- **minor** `apps/scene-playground/src/ui/main.ts:305` — switching back to the reports view only hides Studio and never calls `viewportHandle.destroy()` or `SceneRuntime.stop()`, so the RAF transport loop/runtime playback can continue while the view is hidden; suggested fix: pause/stop runtime and destroy or suspend the viewport handle on report switch, then resume intentionally on Studio entry.
- **clean** `apps/scene-playground/src/ui/main.ts:319` — Studio initialization is guarded by `studioInitialized`, so source editor, viewport, and `insert-asset` listeners are not re-bound on spec reload or repeated Studio tab clicks.
- **clean** `apps/scene-playground/src/ui/main.ts:224` — the global keydown listener is installed once during boot and returns early outside Studio; no view-switch listener accumulation found.
- **clean** `apps/scene-playground/src/ui/main.ts:227` — form controls and `.cm-editor` descendants are excluded before `mapKey`, so normal CodeMirror focus should not be stolen by the global keymap.


## 4. innerHTML / XSS surface

- **blocker** `apps/scene-playground/src/ui/main.ts:558` — report markdown links are emitted as raw `<a href="$2">`, so a report containing `[click](javascript:alert(1))` becomes an executable JavaScript URL when expanded; suggested fix: parse links into DOM nodes or at minimum allow only `http:`, `https:`, relative, and `#` URLs, escaping the final attribute value after protocol validation.
- **clean** `apps/scene-playground/src/ui/main.ts:466` — report-card metadata/media fields are escaped before `innerHTML`; I did not find unescaped report title/date/agent/status/excerpt/path insertion in the card shell.
- **clean** `apps/scene-playground/src/ui/studio/tree.ts:79` — spec-derived tree labels (`obj.id`, `pass.pass`, asset id/kind) are escaped or assigned with `textContent`; no direct spec-string HTML injection found there.
- **clean** `apps/scene-playground/src/ui/studio/inspector.ts:387` — inspector section titles and track headings escape spec-derived strings before the few `innerHTML` uses, while editable values are assigned through form values/textContent.


## 5. inspector.ts scrubber math

- **minor** `apps/scene-playground/src/ui/studio/inspector.ts:433` — keyboard scrubbing uses `Shift = 10×` while the mouse scrubber and tooltip say Shift is fine (`0.1×`) and Alt is ultra-fine, so keyboard `Shift+j/k` makes coarser jumps than plain keys; suggested fix: align keyboard multipliers with drag semantics (`Shift = 0.1`, `Alt = 0.01`) or update the UI copy if coarse Shift is intentional.
- **clean** `apps/scene-playground/src/ui/studio/inspector.ts:54` — mouse scrubbing clamps all drag values to each field's min/max before invoking the mutation callback.
- **clean** `apps/scene-playground/src/ui/studio/inspector.ts:438` — keyboard scrubbing also clamps to field min/max after applying the multiplier.
- **minor** `apps/scene-playground/src/ui/studio/inspector.ts:428` — scrub dragging does not disable body text selection, so fast drag gestures off the span can select inspector text while mutating values; suggested fix: set a drag class or `document.body.style.userSelect = "none"` for the active drag and restore it on mouseup.


## 6. tokens.css — var cross-reference (main.ts CSS vs tokens.css)

- **clean** `apps/scene-playground/src/ui/tokens.css:14` — every `var(--…)` reference in `main.ts` `css()` resolves to a token defined in `tokens.css`; no undefined variables found.
- **nit** `apps/scene-playground/src/ui/tokens.css:52` — defined but not referenced by `main.ts` inline CSS: `--font-sans` (`tokens.css:52-56`), `--text-base` (`tokens.css:61`), `--text-xl` (`tokens.css:64`), `--leading-tight` (`tokens.css:67`), `--space-12` (`tokens.css:78`), `--radius-lg` (`tokens.css:85`), `--panel-padding` (`tokens.css:95`), `--elev-ring` (`tokens.css:98`), `--dur-enter` (`tokens.css:106`), `--dur-exit` (`tokens.css:107`); suggested fix: either remove them if Studio owns the full token surface, or keep them documented as reserved/shared tokens if other CSS will consume them.


## Verdict

Studio v2 is close, but not shippable as-is because report markdown link rendering allows `javascript:` URLs. The next highest risks are invalid specs escaping through raw mutation helpers and provenance misclassification/loss under watcher timing. Top-3 fixes: (1) block unsafe markdown href protocols before assigning `innerHTML`; (2) add schema-aware validation/clamping to state mutation helpers; (3) replace the time-only PUT watcher gate with content-hash suppression and preserve distinct rapid agent edits.

