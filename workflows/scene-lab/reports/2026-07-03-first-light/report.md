title: First Light Scene Lab Demos
date: 2026-07-03
agent: SceneFirstLight
status: shipped

# First Light Scene Lab Demos

Three short `scene.v1` demos were authored under `workflows/scene-lab/specs/` and rendered through the offline Three.js scene renderer into `workflows/scene-lab/renders/`. Final specs use repo-root-relative asset paths so the playground can preview them; checks were re-run after that path-style correction.

## Render matrix

| Spec | Render | Duration | Audio | QA verdict |
|---|---|---:|---|---|
| `workflows/scene-lab/specs/beat-grid.scene.json` | `workflows/scene-lab/renders/beat-grid/scene.mp4` | 10.000000s | narration mp3 | Passed: MP4 frames at 2s/5s/8s are visibly non-black, with a VHS-noisy clone grid of the plate. Beat pulse reads as motion over time; individual stills show scale/offset variation but cannot prove pulse alone. |
| `workflows/scene-lab/specs/orbit-halo.scene.json` | `workflows/scene-lab/renders/orbit-halo/scene.mp4` | 10.000000s | none | Passed: MP4 frames at 2s/5s/8s are visibly non-black, with center persona and orbiting edge clones. Bloom is restrained; clone breathing is subtle in static frame grabs. |
| `workflows/scene-lab/specs/y2k-chrome.scene.json` | `workflows/scene-lab/renders/y2k-chrome/scene.mp4` | 8.000000s | none | Passed: MP4 frames at 2s/5s/near-8s are visibly non-black, with legible `SCENE LAB`, strong RGB split, and a heavier glitch/CA moment near the end. |

## Commands run / rerun

Checks:

```sh
bun run --cwd packages/scene-renderer check -- --scene ../../workflows/scene-lab/specs/beat-grid.scene.json
bun run --cwd packages/scene-renderer check -- --scene ../../workflows/scene-lab/specs/orbit-halo.scene.json
bun run --cwd packages/scene-renderer check -- --scene ../../workflows/scene-lab/specs/y2k-chrome.scene.json
```

Still renders at 2s:

```sh
bun run --cwd packages/scene-renderer render -- --scene ../../workflows/scene-lab/specs/beat-grid.scene.json --out ../../workflows/scene-lab/renders/beat-grid --still 2
bun run --cwd packages/scene-renderer render -- --scene ../../workflows/scene-lab/specs/orbit-halo.scene.json --out ../../workflows/scene-lab/renders/orbit-halo --still 2
bun run --cwd packages/scene-renderer render -- --scene ../../workflows/scene-lab/specs/y2k-chrome.scene.json --out ../../workflows/scene-lab/renders/y2k-chrome --still 2
```

Full renders:

```sh
bun run --cwd packages/scene-renderer render -- --scene ../../workflows/scene-lab/specs/beat-grid.scene.json --out ../../workflows/scene-lab/renders/beat-grid
bun run --cwd packages/scene-renderer render -- --scene ../../workflows/scene-lab/specs/orbit-halo.scene.json --out ../../workflows/scene-lab/renders/orbit-halo
bun run --cwd packages/scene-renderer render -- --scene ../../workflows/scene-lab/specs/y2k-chrome.scene.json --out ../../workflows/scene-lab/renders/y2k-chrome
```

Duration probe:

```sh
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 workflows/scene-lab/renders/beat-grid/scene.mp4
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 workflows/scene-lab/renders/orbit-halo/scene.mp4
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 workflows/scene-lab/renders/y2k-chrome/scene.mp4
```

QA frame extraction used 2s/5s/8s for the 10s videos. For `y2k-chrome`, exact `-ss 8` is EOF on an 8.000000s MP4, so the near-8s proof frame was extracted from frame 239, the final frame of the 240-frame render.

## Representative proof frames

- `beat-grid-2s.png` — clone grid is fully visible with VHS noise.
- `orbit-halo-5s.png` — persona center plus orbiting clones.
- `y2k-chrome-2s.png` — settled chrome title with RGB split.
- `y2k-chrome-8s.png` — near-final stronger glitch/chromatic-aberration moment.

## What works

- The scene lane successfully renders real staged assets and pure text scenes through the offline Three.js runtime.
- `beat-grid` is the strongest immediate proof: narration audio muxed, plate cloning is obvious, and the VHS pass gives it a documentary-wall texture.
- `y2k-chrome` clearly shows beat-reactive post treatment; the final-near-8s frame is visibly more torn and color-split than the steadier 2s/5s frames.
- Checks pass for all three final specs, and the three MP4s have the requested durations.

## What looks weak

- `orbit-halo` reads more like cropped edge thumbnails than a clean halo because the square persona asset is large and the orbit radius pushes clones into the frame boundaries. It is not black or broken, but the devotional halo idea would benefit from either smaller clones or a portrait-safe persona crop.
- Beat-pulse visibility is hard to prove from isolated frame grabs. It is visible as changing scale/offset in the rendered motion, but the report frames are static proof of content rather than timing proof.
- `beat-grid` is intentionally dense; the VHS/noise pass makes the grid energetic but also muddies the plate details.

## Toolchain notes

No scene-renderer source bugs were found. One command-shape gotcha: with `bun run --cwd packages/scene-renderer`, the observed working scene argument is `../../workflows/...`, not `workflows/...`, because the script process runs from the package directory.
