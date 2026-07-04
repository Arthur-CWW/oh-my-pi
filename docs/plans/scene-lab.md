# Scene Lab — programmatic video lane

Scene Lab is the code-driven half of Playground video. The thesis is simple: pleometric-style shortform is mostly not VideoGen. It is code-generated motion graphics plus obsessive asset reuse: one plate duplicated into clone fields, text and personas pushed through shader treatments, motion locked to beats, and a human or agent iterating until the loop feels inevitable.

This lane makes that first-class:

1. Write a declarative `scene.v1` JSON spec.
2. Preview it live in `apps/scene-playground`.
3. Render it deterministically in `packages/scene-renderer`.
4. Emit MP4 proof artifacts under `workflows/scene-lab/renders/<name>`.

The important constraint: cheap models must be able to author this without reading renderer source. Keep scenes small, orthogonal, and legible. Prefer five obvious primitives over one clever meta-system.

## Lane strategy

- **Programmatic first.** Use VideoGen for assets when needed; do not ask it to own timing, layout, typography, or repeatable motion. Scene Lab owns those in code.
- **One spec, two hosts.** The live playground and offline renderer consume the same `scene.v1` spec and runtime semantics. Playground is for watching and steering; offline render is for deterministic output.
- **Deterministic by contract.** Motion is a pure function of `(frame, fps, spec)`. No `Date.now`, random runtime state, RAF drift, or unstaged network dependencies.
- **Three.js end-to-end.** The scene-lab lane uses three.js core and hand-rolled post passes. Remotion remains in the recreate lane for now because it is working and proven as of 2026-07-03, but it carries a license position that must be re-verified at `https://www.remotion.dev/license` before scaling a team. HyperFrames remains the license-clean HTML lane. Scene Lab is the strategic direction for license-clean, deterministic 3D/video-programming work.

### Asset paths

Asset `path` values are repo-root-relative by default. The offline renderer may accept spec-dir-relative paths as a fallback, but authoring should prefer repo-root-relative paths so specs can move without breaking. Real specs live in `workflows/scene-lab/specs/` and can be checked with `bun run --cwd packages/scene-renderer check -- --scene <spec>`.

## Spec reference: `scene.v1`

All scene specs are JSON. Adjacent prose may explain choices; the JSON itself should remain valid.

### Top-level fields

- `schemaVersion`: exactly `"scene.v1"`.
- `width`, `height`: output canvas pixels. Use `1080 × 1920` for vertical shorts unless a lane says otherwise.
- `fps`: render frame rate. The shared default is `30`.
- `durationSeconds`: total scene duration in seconds.
- `background`: CSS color string, usually hex.
- `timeline`: beat timing source.
- `assets`: staged media inputs.
- `camera`: perspective camera and optional deterministic tracks.
- `objects`: planes, sprites, text, and groups.
- `post`: full-screen post passes after the base scene render.
- `audio`: optional audio asset selection and gain.

### Timeline

```json
"timeline": { "bpm": 120, "beats": [0.5, 1.0] }
```

- If `beats` is present, those numbers are beat times in seconds and override the BPM grid.
- If `beats` is absent, the renderer derives a beat grid from `bpm`, starting at `0`.
- Beat-reactive tracks and post passes read this same beat source.

### Assets

```json
"assets": [
  { "id": "plate1", "kind": "image", "path": "data/video-recreation/samuelszuchan/bootstrap-20260620/plates-documentary/plates/2026-05-20_7642101474981367054_slide_0/0.png" },
  { "id": "loop1", "kind": "videoFrames", "path": "data/source-archives/tiktok/samuelszuchan/videos/2026-05-20_7642101474981367054.mp4", "frameCount": 180 },
  { "id": "narration", "kind": "audio", "path": "data/video-recreation/samuelszuchan/bootstrap-20260620/tts-birthrate/2026-05-20_7642101474981367054/audio/narration.mp3" }
]
```

- `id`: stable local identifier referenced by objects or audio.
- `kind`: `"image"`, `"videoFrames"`, or `"audio"`.
- `path`: repo-root-relative path. Runtime loads from `${assetBaseUrl}/${asset.path}`.
- `videoFrames`: offline staging extracts deterministic frames from the referenced MP4 or staged frame source and uses `frameCount` for sampling. Live playground preview skips `videoFrames` assets; use offline checks/stills/renders for these specs.

### Camera

```json
"camera": {
  "fov": 50,
  "position": [0, 0, 8],
  "lookAt": [0, 0, 0],
  "tracks": []
}
```

- `fov`: perspective field of view in degrees.
- `position`: `[x, y, z]` camera position.
- `lookAt`: `[x, y, z]` target.
- `tracks`: optional deterministic camera motion using the same track records as objects. Keep camera motion simple: slow pushes and tiny drift beat hyperactive handheld motion.

### Objects

Object kinds:

- `plane`: flat mesh in 3D space, usually for walls and tiles.
- `sprite`: camera-facing image plane, best for personas and stickers.
- `text`: text object with `text`, `font`, and `color`.
- `group`: transform parent for clustered children where supported by the host; keep examples object-level until group support is needed.

Common object fields:

- `id`: unique object identifier.
- `kind`: `"plane"`, `"sprite"`, `"text"`, or `"group"`.
- `asset`: asset id for image/video objects.
- `text`: text content for text objects.
- `font`: CSS font string for text objects.
- `color`: CSS color for text.
- `size`: `[width, height]` in scene units.
- `position`, `rotation`: `[x, y, z]` transforms.
- `scale`: scalar multiplier.
- `opacity`: `0..1`.
- `clone`: optional clone-field generator.
- `tracks`: deterministic animation records.

### Clone fields

```json
"clone": {
  "count": 24,
  "layout": "grid",
  "spacing": 1.2,
  "radius": 4,
  "seed": 7,
  "stagger": 0.05
}
```

- `count`: number of copies including the source instance.
- `layout`: `"grid"`, `"orbit"`, `"spiral"`, `"line"`, or `"scatter"`.
- `spacing`: distance between neighbors for grid and line layouts.
- `radius`: orbit/scatter/spiral extent.
- `seed`: deterministic scatter seed.
- `stagger`: per-clone time delay in seconds. Track evaluation for clone `i` is delayed by `stagger × i`.

Layout grammar:

- `grid`: ordered tile field. Use for documentary plates, video walls, and cloned UI cards.
- `orbit`: circular halo around the source. Use `phasePerClone` in tracks to make the halo breathe.
- `spiral`: hypnotic depth/scale field. Use sparingly; it gets busy fast.
- `line`: ticker, marching row, or stacked chorus.
- `scatter`: deterministic mess. Best for webcore sticker spam and ad-collage energy.

### Tracks

Track props:

- `position.x`, `position.y`, `position.z`
- `rotation.x`, `rotation.y`, `rotation.z`
- `scale`
- `opacity`

Track modes:

#### `keyframes`

```json
{
  "prop": "position.y",
  "mode": "keyframes",
  "keyframes": [
    { "t": 0, "v": 3.5, "ease": "outElastic" },
    { "t": 0.9, "v": 0, "ease": "outElastic" }
  ]
}
```

- `t`: seconds.
- `v`: numeric value.
- `ease`: `"linear"`, `"inOut"`, or `"outElastic"`.
- Use keyframes for entrances, hard cuts, opacity swaps, and slow camera moves.

#### `osc`

```json
{
  "prop": "rotation.z",
  "mode": "osc",
  "osc": { "amp": 0.2, "freqBeats": 1, "phasePerClone": 0.4, "center": 0 }
}
```

Formula: `center + amp × sin(2π × (beatPhase × freqBeats) + cloneIndex × phasePerClone)`.

- `amp`: wave amplitude.
- `freqBeats`: cycles per beat phase.
- `phasePerClone`: clone-index offset. This is the cheap magic for pleometric waves.
- `center`: resting value.

#### `beat`

```json
{
  "prop": "scale",
  "mode": "beat",
  "beat": { "every": 1, "from": 1, "to": 1.3, "attack": 0.05, "decay": 0.3 }
}
```

- On every `N`th beat, jump from `from` toward `to` over `attack` seconds.
- Decay back toward `from` over `decay` seconds.
- Retrigger on the next matching beat.
- Use for pulses, flashes, and kick-drum layout changes.

### Post passes

```json
"post": [
  {
    "pass": "glitch",
    "params": { "strength": 0.15 },
    "beatReactive": { "param": "strength", "every": 1, "amount": 0.5, "decay": 0.25 }
  }
]
```

Supported passes:

- `bloom`: glow and blown highlights.
- `chromaticAberration`: RGB splitting, Y2K lens stress, cheap 3D-website energy.
- `vhs`: scanlines, tape noise, home-video grime.
- `glitch`: displacement and digital tear.
- `feedback`: trail/echo via previous-frame accumulation. Params: `decay`, `zoom`, `rotate`.
- `displacement`: UV warp by procedural seeded noise. Params: `amplitude`, `scale`, `speed`, `seed`.
- `halftone`: dot-screen with optional RGB separation. Params: `dotSize`, `angle`, `rgbSplit`.

`beatReactive` maps a beat envelope onto one numeric pass parameter:

- `param`: parameter name in `params` to modulate.
- `every`: beat interval.
- `amount`: additive intensity on trigger.
- `decay`: seconds to return toward base.

### Audio

```json
"audio": { "asset": "narration", "offsetSeconds": 0, "gainDb": 0 }
```

- `asset`: id of an `audio` asset.
- `offsetSeconds`: start offset.
- `gainDb`: render gain adjustment.

## Agent iteration loop

Use the cheapest proof that can falsify the scene, then climb only when it passes.

1. **Check** the spec for schema and asset staging mistakes.
2. **Still** render one representative frame.
3. **Short frame-range** render a moving slice around the beat or transition.
4. **Full render** only when timing and layout already work.
5. **Playground** is for humans watching and steering taste; offline renderer is the source of deterministic proof.

Do not start with a full MP4 unless the scene is tiny. Do not judge beat sync from a single still.

## Cookbook

Each example below is a complete `scene.v1` spec. Store specs wherever the lane owner asks; the command examples assume `workflows/scene-lab/specs/<name>.json` and render outputs under `workflows/scene-lab/renders/<name>`.

### A. Beat-synced clone grid

Use this when the source material is one strong plate and the motion is the edit. The 24 clones form a documentary grid; every beat pops scale, and the camera pushes slowly from wide to closer.

```json
{
  "schemaVersion": "scene.v1",
  "width": 1080,
  "height": 1920,
  "fps": 30,
  "durationSeconds": 8,
  "background": "#050507",
  "timeline": { "bpm": 120 },
  "assets": [
    {
      "id": "plate1",
      "kind": "image",
      "path": "data/video-recreation/samuelszuchan/bootstrap-20260620/plates-documentary/plates/2026-05-20_7642101474981367054_slide_0/0.png"
    },
    {
      "id": "narration",
      "kind": "audio",
      "path": "data/video-recreation/samuelszuchan/bootstrap-20260620/tts-birthrate/2026-05-20_7642101474981367054/audio/narration.mp3"
    }
  ],
  "camera": {
    "fov": 48,
    "position": [0, 0, 9],
    "lookAt": [0, 0, 0],
    "tracks": [
      {
        "prop": "position.z",
        "mode": "keyframes",
        "keyframes": [
          { "t": 0, "v": 9, "ease": "linear" },
          { "t": 8, "v": 6.8, "ease": "inOut" }
        ]
      }
    ]
  },
  "objects": [
    {
      "id": "plate-grid",
      "kind": "plane",
      "asset": "plate1",
      "size": [1.55, 2.05],
      "position": [0, 0, 0],
      "rotation": [0, 0, 0],
      "scale": 1,
      "opacity": 1,
      "clone": {
        "count": 24,
        "layout": "grid",
        "spacing": 1.22,
        "radius": 0,
        "seed": 7,
        "stagger": 0.025
      },
      "tracks": [
        {
          "prop": "scale",
          "mode": "beat",
          "beat": { "every": 1, "from": 0.92, "to": 1.08, "attack": 0.04, "decay": 0.22 }
        },
        {
          "prop": "rotation.z",
          "mode": "osc",
          "osc": { "amp": 0.025, "freqBeats": 0.5, "phasePerClone": 0.18, "center": 0 }
        }
      ]
    }
  ],
  "post": [
    { "pass": "bloom", "params": { "strength": 0.12 } }
  ],
  "audio": { "asset": "narration", "offsetSeconds": 0, "gainDb": 0 }
}
```

Commands:

```sh
bun run --cwd packages/scene-renderer check -- --scene workflows/scene-lab/specs/beat-clone-grid.json
bun run --cwd packages/scene-renderer still -- --scene workflows/scene-lab/specs/beat-clone-grid.json --frame 60 --out workflows/scene-lab/renders/beat-clone-grid/still-000060.png
bun run --cwd packages/scene-renderer render -- --scene workflows/scene-lab/specs/beat-clone-grid.json --frames 45:105 --out workflows/scene-lab/renders/beat-clone-grid
bun run --cwd packages/scene-renderer render -- --scene workflows/scene-lab/specs/beat-clone-grid.json --out workflows/scene-lab/renders/beat-clone-grid
```

### B. Orbit halo

Use this when a persona image should feel iconic, devotional, or sticker-mythic. The center sprite holds still while 12 halo clones breathe around it with per-clone phase.

```json
{
  "schemaVersion": "scene.v1",
  "width": 1080,
  "height": 1920,
  "fps": 30,
  "durationSeconds": 7,
  "background": "#08030f",
  "timeline": { "bpm": 96 },
  "assets": [
    {
      "id": "persona",
      "kind": "image",
      "path": "data/video-recreation/samuelszuchan/bootstrap-20260620/jimeng-persona/artifacts/82fdd5d8-37b7-405e-bc81-ca0d748eb821-00.png"
    }
  ],
  "camera": {
    "fov": 42,
    "position": [0, 0, 8],
    "lookAt": [0, 0, 0],
    "tracks": []
  },
  "objects": [
    {
      "id": "persona-center",
      "kind": "sprite",
      "asset": "persona",
      "size": [2.7, 3.4],
      "position": [0, 0, 0.25],
      "rotation": [0, 0, 0],
      "scale": 1,
      "opacity": 1,
      "tracks": [
        {
          "prop": "scale",
          "mode": "beat",
          "beat": { "every": 2, "from": 1, "to": 1.04, "attack": 0.08, "decay": 0.38 }
        }
      ]
    },
    {
      "id": "persona-halo",
      "kind": "sprite",
      "asset": "persona",
      "size": [1.0, 1.25],
      "position": [0, 0, -0.15],
      "rotation": [0, 0, 0],
      "scale": 0.72,
      "opacity": 0.62,
      "clone": {
        "count": 12,
        "layout": "orbit",
        "spacing": 1,
        "radius": 3.05,
        "seed": 12,
        "stagger": 0.04
      },
      "tracks": [
        {
          "prop": "scale",
          "mode": "osc",
          "osc": { "amp": 0.16, "freqBeats": 1, "phasePerClone": 0.52, "center": 0.72 }
        },
        {
          "prop": "rotation.z",
          "mode": "osc",
          "osc": { "amp": 0.2, "freqBeats": 0.25, "phasePerClone": 0.52, "center": 0 }
        },
        {
          "prop": "opacity",
          "mode": "beat",
          "beat": { "every": 1, "from": 0.42, "to": 0.78, "attack": 0.05, "decay": 0.3 }
        }
      ]
    }
  ],
  "post": [
    {
      "pass": "bloom",
      "params": { "strength": 0.35 },
      "beatReactive": { "param": "strength", "every": 2, "amount": 0.25, "decay": 0.4 }
    }
  ]
}
```


Commands:

```sh
bun run --cwd packages/scene-renderer check -- --scene workflows/scene-lab/specs/orbit-halo.json
bun run --cwd packages/scene-renderer still -- --scene workflows/scene-lab/specs/orbit-halo.json --frame 72 --out workflows/scene-lab/renders/orbit-halo/still-000072.png
bun run --cwd packages/scene-renderer render -- --scene workflows/scene-lab/specs/orbit-halo.json --frames 54:114 --out workflows/scene-lab/renders/orbit-halo
bun run --cwd packages/scene-renderer render -- --scene workflows/scene-lab/specs/orbit-halo.json --out workflows/scene-lab/renders/orbit-halo
```

### C. Y2K chrome text

Use this when the asset is typography itself: glossy, overconfident, early-3D-web title energy. The text drops in with `outElastic`, then RGB split and tape grime keep it from becoming clean tech branding.

```json
{
  "schemaVersion": "scene.v1",
  "width": 1080,
  "height": 1920,
  "fps": 30,
  "durationSeconds": 6,
  "background": "#02020a",
  "timeline": { "bpm": 132, "beats": [0, 0.45, 0.9, 1.36, 1.82, 2.27, 2.73, 3.18, 3.64, 4.09, 4.55, 5.0, 5.45] },
  "assets": [],
  "camera": {
    "fov": 46,
    "position": [0, 0, 7],
    "lookAt": [0, 0, 0],
    "tracks": []
  },
  "objects": [
    {
      "id": "chrome-title",
      "kind": "text",
      "text": "XANADU",
      "font": "900 132px Impact, Arial Black, sans-serif",
      "color": "#d9f7ff",
      "size": [5.8, 1.2],
      "position": [0, 0, 0],
      "rotation": [0, 0, 0],
      "scale": 1,
      "opacity": 1,
      "tracks": [
        {
          "prop": "position.y",
          "mode": "keyframes",
          "keyframes": [
            { "t": 0, "v": 3.2, "ease": "outElastic" },
            { "t": 0.75, "v": 0.2, "ease": "outElastic" },
            { "t": 5.5, "v": 0.2, "ease": "linear" }
          ]
        },
        {
          "prop": "scale",
          "mode": "beat",
          "beat": { "every": 1, "from": 1, "to": 1.08, "attack": 0.035, "decay": 0.2 }
        },
        {
          "prop": "rotation.z",
          "mode": "osc",
          "osc": { "amp": 0.035, "freqBeats": 0.5, "phasePerClone": 0, "center": 0 }
        }
      ]
    }
  ],
  "post": [
    {
      "pass": "chromaticAberration",
      "params": { "strength": 0.24 },
      "beatReactive": { "param": "strength", "every": 1, "amount": 0.18, "decay": 0.24 }
    },
    { "pass": "vhs", "params": { "strength": 0.18 } }
  ]
}
```

Commands:

```sh
bun run --cwd packages/scene-renderer check -- --scene workflows/scene-lab/specs/y2k-chrome-text.json
bun run --cwd packages/scene-renderer still -- --scene workflows/scene-lab/specs/y2k-chrome-text.json --frame 24 --out workflows/scene-lab/renders/y2k-chrome-text/still-000024.png
bun run --cwd packages/scene-renderer render -- --scene workflows/scene-lab/specs/y2k-chrome-text.json --frames 0:75 --out workflows/scene-lab/renders/y2k-chrome-text
bun run --cwd packages/scene-renderer render -- --scene workflows/scene-lab/specs/y2k-chrome-text.json --out workflows/scene-lab/renders/y2k-chrome-text
```

### D. 2000s-web-ad style transplant

Use this for visual grammar only: pulsing button shapes, starbursts, drop shadows, garish palette, sticker clutter, fake urgency. Never transplant the subject matter of old banner/dating ads. The scene below uses one safe plate as raw material, scatters it like an ad collage, and hard-cuts clones with opacity keyframes while glitch spikes on the beat.

```json
{
  "schemaVersion": "scene.v1",
  "width": 1080,
  "height": 1920,
  "fps": 30,
  "durationSeconds": 6,
  "background": "#fffb00",
  "timeline": { "bpm": 150 },
  "assets": [
    {
      "id": "plate1",
      "kind": "image",
      "path": "data/video-recreation/samuelszuchan/bootstrap-20260620/plates-documentary/plates/2026-05-20_7642101474981367054_slide_1/0.png"
    }
  ],
  "camera": {
    "fov": 52,
    "position": [0, 0, 8],
    "lookAt": [0, 0, 0],
    "tracks": []
  },
  "objects": [
    {
      "id": "scatter-plate",
      "kind": "plane",
      "asset": "plate1",
      "size": [1.25, 1.65],
      "position": [0, 0, 0],
      "rotation": [0, 0, 0],
      "scale": 1,
      "opacity": 1,
      "clone": {
        "count": 18,
        "layout": "scatter",
        "spacing": 0.8,
        "radius": 4.4,
        "seed": 404,
        "stagger": 0.015
      },
      "tracks": [
        {
          "prop": "opacity",
          "mode": "keyframes",
          "keyframes": [
            { "t": 0, "v": 1, "ease": "linear" },
            { "t": 1.2, "v": 1, "ease": "linear" },
            { "t": 1.21, "v": 0.28, "ease": "linear" },
            { "t": 2.0, "v": 0.28, "ease": "linear" },
            { "t": 2.01, "v": 1, "ease": "linear" },
            { "t": 4.0, "v": 1, "ease": "linear" },
            { "t": 4.01, "v": 0.45, "ease": "linear" },
            { "t": 5.2, "v": 1, "ease": "linear" }
          ]
        },
        {
          "prop": "scale",
          "mode": "beat",
          "beat": { "every": 1, "from": 0.8, "to": 1.35, "attack": 0.025, "decay": 0.18 }
        },
        {
          "prop": "rotation.z",
          "mode": "osc",
          "osc": { "amp": 0.35, "freqBeats": 1, "phasePerClone": 0.9, "center": 0 }
        }
      ]
    },
    {
      "id": "button-copy",
      "kind": "text",
      "text": "CLICK THE DOME",
      "font": "900 86px Impact, Arial Black, sans-serif",
      "color": "#ff00d4",
      "size": [5.5, 0.9],
      "position": [0, -3.1, 0.35],
      "rotation": [0, 0, -0.04],
      "scale": 1,
      "opacity": 1,
      "tracks": [
        {
          "prop": "scale",
          "mode": "beat",
          "beat": { "every": 1, "from": 1, "to": 1.22, "attack": 0.03, "decay": 0.2 }
        }
      ]
    }
  ],
  "post": [
    {
      "pass": "glitch",
      "params": { "strength": 0.18 },
      "beatReactive": { "param": "strength", "every": 1, "amount": 0.7, "decay": 0.16 }
    },
    {
      "pass": "chromaticAberration",
      "params": { "strength": 0.3 },
      "beatReactive": { "param": "strength", "every": 2, "amount": 0.2, "decay": 0.22 }
    }
  ]
}
```

Commands:

```sh
bun run --cwd packages/scene-renderer check -- --scene workflows/scene-lab/specs/web-ad-transplant.json
bun run --cwd packages/scene-renderer still -- --scene workflows/scene-lab/specs/web-ad-transplant.json --frame 45 --out workflows/scene-lab/renders/web-ad-transplant/still-000045.png
bun run --cwd packages/scene-renderer render -- --scene workflows/scene-lab/specs/web-ad-transplant.json --frames 30:105 --out workflows/scene-lab/renders/web-ad-transplant
bun run --cwd packages/scene-renderer render -- --scene workflows/scene-lab/specs/web-ad-transplant.json --out workflows/scene-lab/renders/web-ad-transplant
```

### E. Video-texture wall

Use this offline-only pattern when a staged video has already been exploded into deterministic frames. The spec contains a `videoFrames` asset and tiles it 3 × 3. Staggered playback is a renderer concern: the authored scene should express clone stagger and deterministic tracks; the offline host samples frames from the staged directory by render frame.

```json
{
  "schemaVersion": "scene.v1",
  "width": 1080,
  "height": 1920,
  "fps": 30,
  "durationSeconds": 8,
  "background": "#000000",
  "timeline": { "bpm": 110 },
  "assets": [
    {
      "id": "source-loop",
      "kind": "videoFrames",
      "path": "data/source-archives/tiktok/samuelszuchan/videos/2026-05-20_7642101474981367054.mp4",
      "frameCount": 240
    }
  ],
  "camera": {
    "fov": 50,
    "position": [0, 0, 7.8],
    "lookAt": [0, 0, 0],
    "tracks": [
      {
        "prop": "position.z",
        "mode": "osc",
        "osc": { "amp": 0.25, "freqBeats": 0.25, "phasePerClone": 0, "center": 7.8 }
      }
    ]
  },
  "objects": [
    {
      "id": "video-wall",
      "kind": "plane",
      "asset": "source-loop",
      "size": [1.85, 2.55],
      "position": [0, 0, 0],
      "rotation": [0, 0, 0],
      "scale": 1,
      "opacity": 1,
      "clone": {
        "count": 9,
        "layout": "grid",
        "spacing": 1.92,
        "radius": 0,
        "seed": 9,
        "stagger": 0.08
      },
      "tracks": [
        {
          "prop": "position.z",
          "mode": "osc",
          "osc": { "amp": 0.18, "freqBeats": 0.5, "phasePerClone": 0.45, "center": 0 }
        },
        {
          "prop": "opacity",
          "mode": "beat",
          "beat": { "every": 2, "from": 0.84, "to": 1, "attack": 0.06, "decay": 0.28 }
        }
      ]
    }
  ],
  "post": [
    { "pass": "vhs", "params": { "strength": 0.22 } },
    { "pass": "bloom", "params": { "strength": 0.1 } }
  ]
}
```

Commands:

```sh
bun run --cwd packages/scene-renderer check -- --scene workflows/scene-lab/specs/video-texture-wall.json
bun run --cwd packages/scene-renderer still -- --scene workflows/scene-lab/specs/video-texture-wall.json --frame 90 --out workflows/scene-lab/renders/video-texture-wall/still-000090.png
bun run --cwd packages/scene-renderer render -- --scene workflows/scene-lab/specs/video-texture-wall.json --frames 75:135 --out workflows/scene-lab/renders/video-texture-wall
bun run --cwd packages/scene-renderer render -- --scene workflows/scene-lab/specs/video-texture-wall.json --out workflows/scene-lab/renders/video-texture-wall
```

### F. Feedback trail

Accumulates previous frames for motion trails and echo. The chain maintains a history buffer that records the fully processed frame after all passes; on the next frame the feedback pass blends the current scene with this history. History resets deterministically at frame 0.

Params: `decay` (0–1, how much history bleeds through; default 0.65), `zoom` (per-frame scale of trail center, e.g. 1.002 for slow zoom-in; default 1.0), `rotate` (per-frame rotation in radians, e.g. 0.004 for slow spiral; default 0.0).

```json
{ "pass": "feedback", "params": { "decay": 0.62, "zoom": 1.002, "rotate": 0.004 } }
```

Commands:

```sh
bun run --cwd packages/scene-renderer check -- --scene workflows/scene-lab/specs/feedback-trail.scene.json
bun run --cwd packages/scene-renderer render -- --scene workflows/scene-lab/specs/feedback-trail.scene.json --out workflows/scene-lab/renders/feedback-trail --still 4
```

### G. Displacement warp

UV distortion by procedural seeded noise. Deterministic: noise is driven by spec time and a fixed `seed`, never `Math.random`. Beat-reactive on `amplitude` works naturally through the existing `beatReactive` spec field.

Params: `amplitude` (displacement strength; default 0.008), `scale` (noise frequency; default 4.0), `speed` (time-driven noise evolution; default 0.3), `seed` (deterministic offset; default 0.0).

```json
{
  "pass": "displacement",
  "params": { "amplitude": 0.018, "scale": 5.0, "speed": 0.4, "seed": 42 },
  "beatReactive": { "param": "amplitude", "every": 1, "amount": 0.012, "decay": 0.25 }
}
```

Commands:

```sh
bun run --cwd packages/scene-renderer check -- --scene workflows/scene-lab/specs/displacement-warp.scene.json
bun run --cwd packages/scene-renderer render -- --scene workflows/scene-lab/specs/displacement-warp.scene.json --out workflows/scene-lab/renders/displacement-warp --still 2
```

### H. Halftone dot screen

Classic print look: dot-screen thresholding with optional RGB channel separation. Produces a newspaper/risograph texture. In RGB mode, three dot grids at 0°/60°/30° offsets create a rosette moiré.

Params: `dotSize` (dot frequency per UV unit; default 24.0), `angle` (screen rotation in radians; default 0.785), `rgbSplit` (0 = monochrome, 1 = RGB separated screens; default 1.0).

```json
{ "pass": "halftone", "params": { "dotSize": 22, "angle": 0.3, "rgbSplit": 1 } }
```

Commands:

```sh
bun run --cwd packages/scene-renderer check -- --scene workflows/scene-lab/specs/halftone-print.scene.json
bun run --cwd packages/scene-renderer render -- --scene workflows/scene-lab/specs/halftone-print.scene.json --out workflows/scene-lab/renders/halftone-print --still 2
```

## Style vocabulary

Use these as named recipes when asking another agent for a scene. They map taste words to concrete spec fragments.

### Y2K chrome

- Background: near-black navy or electric blue.
- Object: one large `text` object, heavy font, pale cyan or silver color.
- Motion: `outElastic` `position.y` entrance, beat `scale` pulse.
- Post: `chromaticAberration` base `strength` around `0.2`, beat-reactive spikes; light `vhs` so it does not become sterile.

### VHS home-video

- Background: black, charcoal, or muted household color.
- Objects: large planes/sprites with slight `rotation.z` osc.
- Motion: slow `position.z` camera osc or push; low-amplitude clone stagger.
- Post: `vhs` as the main pass, optional low bloom.
- Audio: narration or room-tone asset carries the intimacy.

### Webcore / 2000s-ad

- Background: saturated yellow, cyan, magenta, or hard gradient simulated by plates.
- Objects: `scatter` clones, text as fake button copy, visible clutter.
- Motion: beat `scale` with fast attack, hard opacity keyframes for cuts.
- Post: aggressive `glitch` beatReactive and `chromaticAberration`.
- Rule: borrow visual grammar only — pulsing buttons-look, starbursts, drop shadows, urgent layout. Never borrow exploitative subject matter.

### Documentary-grid

- Background: black or off-white.
- Objects: `grid` clones of plates from the recreate lane's black-and-white grid look.
- Motion: restrained beat pulse, tiny rotation waves, slow camera push.
- Post: low bloom or mild VHS only. The grid should read as evidence wall, not nightclub.

## Authoring guardrails

- Do not invent fields. If the spec cannot express a desire, say so and simplify.
- Use explicit `id`s that read like stage directions: `plate-grid`, `chrome-title`, `persona-halo`.
- Prefer one strong motion idea per object.
- Keep clone counts legible. Twenty-four grid clones is texture; two hundred clones is usually mud.
- Use `beats` only when you need exact sync. Otherwise `bpm` is easier for agents.
- Never rely on runtime network access except staged asset fetches through `assetBaseUrl`.
- For VideoGen output, freeze it into assets first; Scene Lab owns timing after that.
