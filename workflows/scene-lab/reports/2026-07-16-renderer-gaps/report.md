---
title: scene.v1 renderer gap fixes
date: 2026-07-16
agent: RendererGaps
status: shipped
---

# Renderer gap fixes

## What landed

### Halftone blend

Root cause: `packages/scene-renderer/src/runtime/post/passes/halftone.ts` always replaced the input with the dot-screen result. The pass now exposes `mix`, clamps it to 0..1 at render time, and computes `mix(input, halftoned, mix)`. The default is `1`, preserving prior output. The schema rejects out-of-range authored values. Cookbook §H and the supported-pass summary now document it.

Exact scene shape:

```json
{
  "pass": "halftone",
  "params": {
    "dotSize": 22,
    "angle": 0.3,
    "rgbSplit": 1,
    "mix": 0.45
  }
}
```

`mix: 0` is the untouched input; `mix: 1` is full halftone.

### Sprite `rotation.z`

Root cause: Three.js billboards ignore the Sprite object's Euler roll. Three.js does support in-plane billboard rotation through `SpriteMaterial.rotation`. Static authored roll, clone roll, and animated `rotation.z` tracks now synchronize that material field. Text uses the same SpriteMaterial path and benefits as well; no plane fallback or schema warning is needed.

The proof measurement found the two authored ±0.7-radian rectangular sprites at principal axes +40.2° and -40.3° (image coordinates report the equivalent 139.7°/-139.8° axes), demonstrating that the billboard material actually rolled.

### Offline audio cues and cue-snapped keyframes

`packages/scene-renderer/scripts/analyze-audio.ts` accepts WAV or MP3 through the existing `ffmpeg` executable, decodes mono 22.05 kHz float PCM, computes an RMS energy envelope and positive energy-flux onsets with a robust median/MAD threshold, and writes deterministic JSON. No library dependency was added.

Command:

```sh
bun run --cwd packages/scene-renderer analyze-audio -- ../../workflows/scene-lab/reports/2026-07-15-local-tts/what-lab-am_michael.wav --out ../../workflows/scene-lab/specs/demos/what-lab.cues.json
```

Observed output: 142 onsets and 713 energy samples.

Exact cue-file shape:

```json
{
  "schemaVersion": "scene.cues.v1",
  "source": "path/to/audio.wav",
  "durationSeconds": 33.1,
  "sampleRateHz": 22050,
  "onsets": [0.4412, 0.8359],
  "energy": [{ "t": 0, "v": 0 }]
}
```

Exact track addition:

```json
{
  "prop": "rotation.z",
  "mode": "keyframes",
  "timing": { "cues": "what-lab.cues.json", "mode": "snap" },
  "keyframes": [
    { "t": 0.55, "v": 0.35, "ease": "outElastic" }
  ]
}
```

For `mode: "snap"`, each authored keyframe time is replaced offline at runtime initialization by the nearest onset in the referenced cue file. Cue paths are resolved with the same repo-root/spec-directory rules as scene assets, copied into the render staging directory, fetched once per unique path, validated as `scene.cues.v1`, then applied before frame 0.

## Demos and proofs

- `workflows/scene-lab/specs/demos/halftone-mix.scene.json`
  - `halftone-mix/still-1s.png` — 640×360 partial RGB dot screen at `mix: 0.45`; 8,054 distinct RGB colors and midtones across all 230,400 pixels confirm it is not the prior binary hard replacement.
- `workflows/scene-lab/specs/demos/sprite-rotation.scene.json`
  - `sprite-rotation/still-0s.png` — opposing ±0.7-radian sprite rolls plus a rolled text sprite.
- `workflows/scene-lab/specs/demos/audio-cue-snap.scene.json`
  - `audio-cue-snap/scene.mp4` — 2.000-second, 640×360, 30 fps H.264 clip with AAC narration; the rotation keyframes consume `what-lab.cues.json` in snap mode.

All proof artifacts live beneath this report directory.

## Verification

```text
bun test test/schema.test.ts test/runtime-math.test.ts test/stage.test.ts test/builders.test.ts test/passes-determinism.test.ts
21 pass, 0 fail, 61 expect() calls

tsc --noEmit
exit 0

scene-check halftone-mix.scene.json
OK: 3 objects, 0 assets, 60 frames
scene-check sprite-rotation.scene.json
OK: 3 objects, 0 assets, 60 frames
scene-check audio-cue-snap.scene.json
OK: 2 objects, 1 assets, 60 frames
```

Focused tests cover halftone schema bounds/default, static SpriteMaterial roll, nearest-onset snapping, cue staging and path rewriting, and existing runtime math/pass invariants.

## What remains of audio-onset gap #1

This is intentionally only the minimal snap slice. Not implemented: dense-cluster selection, accelerate-to-hit envelopes, downbeat/bar classification, spectral-band cues, or post-parameter event tracks. The emitted energy envelope is available for a later mode but is not consumed tonight.

## Handoff note

A direct IRC notification to `FirstPiece` was attempted after the fixes rendered, but that sibling was already archived and non-revivable; the IRC bus rejected delivery. A relay to `Main` was also attempted and rejected because its live session had ended. The usable contract is recorded above and in the demo specs.
