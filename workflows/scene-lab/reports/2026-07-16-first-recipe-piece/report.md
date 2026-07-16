---
title: "What Lab? — first recipe-driven concept piece"
date: 2026-07-16
agent: FirstPiece
status: done
---

# What Lab? — first recipe-driven concept piece

First end-to-end local loop: corpus → recipe → scene.v1 → local TTS → rendered video, $0. Script (b) from `docs/research/power-posting-sources/vibe-brief.md` §6. Register: cold declarative → institutional → menace button.

- **Spec:** `workflows/scene-lab/specs/what-lab.scene.json`
- **Frame:** 1080×1920 **PORTRAIT**, 30 fps, **34.0 s** (33.1 s narration + 0.9 s silent coda), 11 objects / ~132 clones, 4 post passes, deterministic.
- **Ink:** bone `#f2ead9` + vermilion `#ff3b1d` on warm near-black `#0a0810`. No third ink.
- **Audio:** Kokoro `am_michael` voice, `what-lab-am_michael.wav` from `2026-07-15-local-tts/`.
- **Recipe:** Primary = **Typographic Incantation** (Recipe 4). Supporting = **Terminal Reliquary** (Recipe 1).

## The script (87 words)

> Honestly, labs is such bullshit. What lab? Why are we calling it a lab? It is a trillion-dollar corporation with five thousand people building a superweapon in secrecy, dropping hints from time to time. DeepSeek is a lab. This is a ticking time bomb. Imagine if Los Alamos were a private actor, guarding its cute know-hows, never publishing anything. But that is exactly what they say it is. And I don't see how a nation-state lets that be anything more than a facade, in the long run.

Source: @teortaxesTex, near-verbatim splice from `teortaxes-longposts.md` §2.

## Four movements

| # | Movement | window (s) | still | what happens |
|---|----------|-----------|-------|--------------|
| 1 | **The Question** | 0.0 – 6.5 | `movement-1-lab-title.png` (t=1.0), `movement-1-question.png` (t=3.0) | bone "LAB" fades in centered on near-black; institutional title card. On "What lab?" a `line` field of question marks appears, beat-pulsing. The frame reads as a clean corporate surface with the first crack showing. |
| 2 | **The Mechanism** | 6.5 – 19.0 | `movement-2-mechanism.png` (t=10.0), `movement-2-time-bomb.png` (t=17.0) | "LAB" dissolves; vermilion "SUPERWEAPON" hard-cuts in (one-frame flash entrance at 9.15s). Bone `grid` clones of "$1T" and "5,000" stamp in as ticker-style figures. "DEEPSEEK IS A LAB" enters with an elastic bounce. Vermilion "TIME BOMB" spawns as `orbit` clone field, 6 clones pulsing every beat. |
| 3 | **The Analogy** | 19.0 – 25.0 | `movement-3-los-alamos.png` (t=21.0) | All mechanism elements collapse. "LOS ALAMOS" arrives in vermilion with a 16-clone `orbit` halo — detonation geometry, the bomb compared to the lab. Clones breathe with per-clone phase. Camera begins to push and roll. |
| 4 | **The Dread** | 25.0 – 34.0 | `movement-4-facade.png` (t=30.0) | Orbit collapses. Dim "NATION-STATE" `line` field of 6 clones drifts behind. Bone "FACADE" fades in large, centered, monumental — the word doing all the work. 0.9s silent coda: the facade holds, VHS grime persists, nothing resolves. |

## Narration timing table

87 words at ~2.63 wps (deadpan `am_michael` at speed 0.9). Timings are nominal from word count; the WAV is 33.10 s. Each sentence anchors to a visual event in the spec.

| Mv | # | sentence | words | start | end | visual anchor |
|----|---|----------|-------|-------|-----|---------------|
| 1 | 1 | Honestly, labs is such bullshit. | 5 | 0.3 | 2.2 | `lab-title` faded in by 0.5 |
| 1 | 2 | What lab? | 2 | 2.4 | 3.2 | `question-field` appears (2.5), beat-pulse |
| 1 | 3 | Why are we calling it a lab? | 8 | 3.5 | 6.4 | question marks pulsing, field held |
| 2 | 4a | It is a trillion-dollar corporation with five thousand people | 10 | 6.8 | 9.0 | `lab-title` fades (6.8), `ticker-grid` spawns (9.0) |
| 2 | 4b | building a superweapon in secrecy, dropping hints from time to time. | 10 | 9.0 | 14.0 | `superweapon` flash (9.15), `five-k` grid (10.3) |
| 2 | 5 | DeepSeek is a lab. | 4 | 14.5 | 16.0 | `deepseek-label` elastic entrance (14.6) |
| 2 | 6 | This is a ticking time bomb. | 7 | 16.3 | 18.8 | `time-bomb` orbit spawns (16.4), all mv2 elements fade (19.2) |
| 3 | 7 | Imagine if Los Alamos were a private actor, guarding its cute know-hows, never publishing anything. | 15 | 19.2 | 24.7 | `los-alamos-core` orbit halo (19.6), 16 clones breathing |
| 3 | 8 | But that is exactly what they say it is. | 10 | 25.0 | 28.7 | orbit collapses (25.0) |
| 4 | 9 | And I don't see how a nation-state lets that be anything more than a facade, in the long run. | 19 | 29.0 | 33.1 | `nation-state-field` drifts (27.8), `facade-text` arrives (29.3), holds to end |

`timeline.beats` are keyed to phrase/clause onsets (20 explicit beats across 33s). Beat-reactive displacement, chromatic aberration, and bloom spike on these syntactic boundaries. The beats stop at 33.0 — the final second is clinical silence.

## Design note — recipe grammar → visual choices

### Primary: Typographic Incantation (Recipe 4)

Recipe grammar: "words arrive as beats, repeat as architecture, and remain legible under pressure."

| Visual choice | Recipe grammar element | Catalog exemplar |
|---|---|---|
| Single words as objects ("LAB", "SUPERWEAPON", "FACADE") | "one phrase per visual breath" — each word is a held image | `2022433309612216701-1` (fragmented kinetic words) |
| `line` clone field of "?" marks | "tiled refrains" — repetition as architecture | `2068025479026593909-1` (tiled imperative speech) |
| `grid` clones of "$1T" and "5,000" | "equation/notation overlays" — data as visual texture | `2057289057483346095-1` (equations over clone field) |
| Hard-cut entrance of "SUPERWEAPON" (3-frame opacity flash) | "hard-cut text at sentence pivots" | `2022433309612216701-1` (fragmented kinetic words) |
| Beat-reactive scale on every text object | "scale-pop at rest" — elastic entrances sparingly | `2050364782411202781-1` (kinetic takeoff captions) |
| Beats keyed to spoken phrase onsets, not BPM grid | "time each phrase reveal to the spoken onset" | Recipe 4 audio coupling rule |

### Supporting: Terminal Reliquary (Recipe 1)

Recipe grammar: "make the frame feel like a machine delivering a revelation: austere, occult, technical, and already in progress."

| Visual choice | Recipe grammar element | Catalog exemplar |
|---|---|---|
| Dim `void-grid` lattice behind all text | "one deep plane plus a restrained grid" — institutional depth | `2040599459151720517-1` (LED-grid corporate retro-futurism) |
| `vhs` post pass at low strength | "CRT/VHS grime is the carrier layer" | `2049999955834568734-1` (HR-video VHS/scanlines) |
| Bone/vermilion on near-black palette | "warm near-black or true black ground; bone, terminal green, or warning-red marks" | `2070631349778579630-1` (cyber-occult diagrams) |
| Slow camera push + micro-roll | "slow camera push or tunnel zoom" | `2023448161323221147-1` (monochrome ASCII display) |
| `Courier New` monospace for ticker values | "monospaced or narrow grotesk, aligned like telemetry" | `2040599459151720517-1` |

### Halftone intentionally omitted

The vibe-brief's visual direction calls for `halftone` on low for the sober-document look. Same decision as `number-no-name` v1: the halftone shader has no `mix`/`opacity` uniform, so it cannot be blended as a subtle print grain. At full strength it floods the warm-black void with RGB moiré dots. VHS at 0.1 strength delivers the institutional grime without the palette violation. RendererGaps is fixing the halftone gap; this piece can be re-rendered with halftone mix when the fix lands.

### Known limits respected

- **Sprite `rotation.z` ignored:** all text objects are `THREE.Sprite`; no `rotation.z` tracks placed on any text object. Camera roll (≤0.016 rad) provides the only rotational motion.
- **No feedback pass:** omitted to allow chunked rendering. Each frame is a pure function of its index, so chunk boundaries are frame-accurate.

## Verification

- **check passes:** `OK: 11 objects, 1 assets, 1020 frames`.
- **`ffprobe`:** 2 streams, container `duration=34.000000`. Video `h264, 1080×1920 portrait, 30 fps, 1020 frames, duration=34.000000`. Audio `aac, 24000 Hz, mono, duration=33.100000`.
- **Audio is real:** `volumedetect` → `n_samples: 794624`, `mean_volume: -28.2 dB`, `max_volume: -6.1 dB` (real speech dynamics).
- **Coda is silent:** `volumedetect` on 33.5–34.0 s → `n_samples: 0`.
- **Stills inspected:** 6 movement stills cover all 4 movements. Text is legible, palette is bone+vermilion on near-black only, no third ink.

## Rerun commands (from repo root)

```sh
# validate
cd packages/scene-renderer
bun src/check.ts --scene ../../workflows/scene-lab/specs/what-lab.scene.json

# one still (e.g. movement 3 — Los Alamos orbit)
bun src/render.ts --scene ../../workflows/scene-lab/specs/what-lab.scene.json \
  --out /tmp/what-lab-stills --still 21.0

# full 34 s render — chunked at ≤250 frames to survive browser memory limits (no feedback pass ⇒ frame-accurate)
rm -rf /tmp/what-lab-chunks /tmp/what-lab-combined
for r in 0-249 250-499 500-624 625-749 750-874 875-1019; do \
  bun src/render.ts --scene ../../workflows/scene-lab/specs/what-lab.scene.json \
    --out /tmp/what-lab-chunks/$r --frame-range $r --keep-frames; done
mkdir -p /tmp/what-lab-combined
for r in 0-249 250-499 500-624 625-749 750-874 875-1019; do \
  cp /tmp/what-lab-chunks/$r/frames/*.png /tmp/what-lab-combined/; done

# mux narration — NO -shortest: 34s video length must win so 0.9s silent coda survives
cd ../..
ffmpeg -y -framerate 30 -start_number 0 -i /tmp/what-lab-combined/%06d.png \
  -i workflows/scene-lab/reports/2026-07-15-local-tts/what-lab-am_michael.wav \
  -c:v libx264 -pix_fmt yuv420p -movflags +faststart -c:a aac \
  workflows/scene-lab/reports/2026-07-16-first-recipe-piece/what-lab.mp4

# verify
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,duration,nb_frames \
  -show_entries format=duration,nb_streams -of json \
  workflows/scene-lab/reports/2026-07-16-first-recipe-piece/what-lab.mp4
```
