title: Post Passes — Feedback, Displacement, Halftone
date: 2026-07-04
agent: ScenePassCraft
status: shipped

# Post Passes — Feedback, Displacement, Halftone

Three new post-processing passes added to `packages/scene-renderer`: **feedback** (trail/echo via history buffer), **displacement** (procedural noise UV warp), and **halftone** (dot-screen with optional RGB separation). All are deterministic, schema-validated, and follow the existing pass pattern.

## Implementation summary

### feedback
- Chain-managed history buffer (ping-pong render target) copies the fully processed frame after all passes.
- Resets deterministically at frame 0.
- Params: `decay` (history retention, 0–1), `zoom` (per-frame center scale), `rotate` (per-frame rotation in radians).
- Still render warms up from frame 0 only when the spec contains a feedback pass; non-feedback stills render the single target frame directly.

### displacement
- Procedural 2D value noise UV warp, driven by `timeSeconds * speed + seed`.
- Params: `amplitude`, `scale`, `speed`, `seed`. Beat-reactive on `amplitude` via existing `beatReactive` spec field.

### halftone
- Dot-screen thresholding. Monochrome or RGB separated screens at 0°/60°/30° offsets.
- Aspect-corrected: UV coordinates are scaled by aspect ratio before rotation and dot distance, so dots remain circular on non-square canvases (e.g. 720x1280).
- Tonality-correct: ink coverage uses `1.0 - brightness` threshold so dark stays dark and bright content shows dot patterns. Smoothstep lower bound clamped to 0.0 to avoid mid-gray artifacts at full brightness.
- Params: `dotSize` (frequency), `angle` (rotation), `rgbSplit` (0 = mono, 1 = RGB).

## Files changed

| File | Change |
|---|---|
| `packages/scene-renderer/src/runtime/post/passes/feedback.ts` | New: feedback pass |
| `packages/scene-renderer/src/runtime/post/passes/displacement.ts` | New: displacement pass |
| `packages/scene-renderer/src/runtime/post/passes/halftone.ts` | New: halftone pass |
| `packages/scene-renderer/src/runtime/post/passes/index.ts` | Export new passes |
| `packages/scene-renderer/src/runtime/post/types.ts` | Add `historyTarget` to `PassContext` |
| `packages/scene-renderer/src/runtime/post/chain.ts` | History buffer lifecycle, `frame` param |
| `packages/scene-renderer/src/runtime/post/index.ts` | Re-export new passes |
| `packages/scene-renderer/src/runtime/index.ts` | Add to `passMap`, pass `frame` to chain |
| `packages/scene-renderer/src/runtime/spec.ts` | Extend `PostPassName` union |
| `packages/scene-renderer/src/schema.ts` | Extend `PostPass` type + `PostSchema` union |
| `packages/scene-renderer/src/render.ts` | Gate still warm-up on feedback pass presence |
| `docs/plans/scene-lab.md` | Cookbook entries F, G, H |

## Render matrix

| Spec | Still | Timestamp | QA |
|---|---|---:|---|
| `workflows/scene-lab/specs/feedback-trail.scene.json` | `workflows/scene-lab/renders/feedback-trail/still-1s.png` | 1s | Slight smear/trail visible on sprite edges |
| `workflows/scene-lab/specs/feedback-trail.scene.json` | `workflows/scene-lab/renders/feedback-trail/still-4s.png` | 4s | 6–10 stacked echo layers, clear progressive accumulation |
| `workflows/scene-lab/specs/displacement-warp.scene.json` | `workflows/scene-lab/renders/displacement-warp/still-2s.png` | 2s | Text visible with smooth wave/warp distortion |
| `workflows/scene-lab/specs/displacement-warp.scene.json` | `workflows/scene-lab/renders/displacement-warp/still-5s.png` | 5s | Text with different warp phase |
| `workflows/scene-lab/specs/halftone-print.scene.json` | `workflows/scene-lab/renders/halftone-print/still-2s.png` | 2s | Circular CMY dots, aspect-correct, correct tonality (dark background stays dark) |
| `workflows/scene-lab/specs/halftone-print.scene.json` | `workflows/scene-lab/renders/halftone-print/still-5s.png` | 5s | Dot pattern with camera push closer, dots circular, tonality preserved |

## Rerun commands

Checks:

```sh
bun run --cwd packages/scene-renderer check -- --scene ../../workflows/scene-lab/specs/feedback-trail.scene.json
bun run --cwd packages/scene-renderer check -- --scene ../../workflows/scene-lab/specs/displacement-warp.scene.json
bun run --cwd packages/scene-renderer check -- --scene ../../workflows/scene-lab/specs/halftone-print.scene.json
```

Still renders (2 timestamps per pass):

```sh
bun run --cwd packages/scene-renderer render -- --scene ../../workflows/scene-lab/specs/feedback-trail.scene.json --out ../../workflows/scene-lab/renders/feedback-trail --still 1
bun run --cwd packages/scene-renderer render -- --scene ../../workflows/scene-lab/specs/feedback-trail.scene.json --out ../../workflows/scene-lab/renders/feedback-trail --still 4
bun run --cwd packages/scene-renderer render -- --scene ../../workflows/scene-lab/specs/displacement-warp.scene.json --out ../../workflows/scene-lab/renders/displacement-warp --still 2
bun run --cwd packages/scene-renderer render -- --scene ../../workflows/scene-lab/specs/displacement-warp.scene.json --out ../../workflows/scene-lab/renders/displacement-warp --still 5
bun run --cwd packages/scene-renderer render -- --scene ../../workflows/scene-lab/specs/halftone-print.scene.json --out ../../workflows/scene-lab/renders/halftone-print --still 2
bun run --cwd packages/scene-renderer render -- --scene ../../workflows/scene-lab/specs/halftone-print.scene.json --out ../../workflows/scene-lab/renders/halftone-print --still 5
```

## Acceptance verification

- `check` CLI passes on all 3 demo specs: confirmed.
- Existing specs (`orbit-halo`, `beat-grid`, `y2k-chrome`) still pass `check`: confirmed (no regression).
- Feedback stills show progressive accumulation: 1s has slight smear, 4s has 6–10 stacked echo layers.
- All 6 stills rendered and on disk.
- Runtime bundle rebuilt successfully.
