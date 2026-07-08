---
title: "The Number With No Name — concept video v1"
date: 2026-07-08
agent: ConceptVideoV1
status: shipped
---

# The Number With No Name

First power-posting concept video. Register: **math horror** (flagship structure — hook-question → mechanism → deep-time verdict → button). Script (c) from `docs/research/power-posting-sources/vibe-brief.md` §6. This is the **silent-first** visual cut; the MiniMax narration muxes in a later pass and re-syncs against the timing table below.

- **Spec:** `workflows/scene-lab/specs/number-no-name.scene.json`
- **Frame:** 720×1280 **PORTRAIT** (TikTok), 30 fps, **46.0 s**, 9 objects / 45 clones, 3 post passes, deterministic (fixed clone seeds, no runtime randomness).
- **Ink:** bone `#f2ead9` + vermilion `#ff3b1d` on warm near-black `#0a0810`. No third ink, no rainbow. Printed, machine — not nightclub.
- **Audio:** none. There is no 46 s click track on disk (`pleo-track-20s.wav` is 20 s music, wrong length + tonally wrong for math-horror), and narration is a later mux — so motion is designed to read with the sound off. Beat cadence comes from `timeline.beats`, which needs no audio asset.

## The script (110 words, house voice)

> How big is the biggest number you will ever need? Here is a game. Take a machine with n rules, start it on a blank tape, and of the ones that stop, keep the one that runs longest. Call it BB of n. BB of five is forty-seven million. We only proved that last year. BB of six is already too big to write with exponentials — you need towers of them, then towers of those. And near seven hundred and forty-five rules, the number goes dark. Not hard to find. Impossible. The axioms of mathematics cannot decide it. There is a number math refuses to name. It was always there.

The plumbing is real (Inv. 4): BB(5) = **47,176,870**, Coq-proven 2024; BB(6) already exceeds any tower of exponentials; a **745**-state machine halts iff ZFC is inconsistent, so BB(745) is independent of ZFC. The on-screen glyphs are those facts: `47,176,870`, escalating exponent towers `9^9 → 9^9^9 → 9^9^9^9`, and the unlit `BB` core.

## Four movements

| # | Movement | window (s) | still | what happens |
|---|----------|-----------|-------|--------------|
| 1 | **Sparse type** | 0.0 – 18.3 | `movement-1-sparse.png` (t=8.0) | bone serif `BB(n)`, one `line` field, rest scale 1.0, camera almost static, a dim warm `void-lattice` grid breathing behind (the CM-field lattice). |
| 2 | **Breeding towers** | 18.3 – 33.5 | `movement-2-breeding-towers.png` (t=31.0) | `forty-seven million` spawns a bone `grid` of the value; then vermilion `orbit` towers stack upward one ring at a time (`9^9`, `9^9^9`, `9^9^9^9`), each rising into place + pulsing `every:2` on an **accelerating** beat cadence — the field visibly breeds (Inv. 6). |
| 3 | **Dark collapse** | 33.5 – 43.0 | `movement-3-dark-collapse.png` (t=40.3) | on "the number goes dark": one **negative-flash** (full-frame bone flash, ~3 frames @ t≈38.87), the whole field collapses to a single dim `BB` `core` the bloom cannot light (threshold raised, low-luma ink). Beats have stopped → chromatic aberration falls to zero, displacement calms. The stillness is the dread. |
| 4 | **Lone glyph** | 43.0 – 46.0 | `movement-4-lone-glyph.png` (t=44.5) | the unlit `BB` holds, then reduces to one dim residual dot on empty warm-black — "it was always there." |

## Narration timing table (re-sync target)

Nominal timings assume a flat, unhurried deadpan read. **110 words at a strict 140 wpm is ~47 s of pure speech**; to fit the 46 s frame this table runs the within-line pace at ~150 wpm with short deadpan gaps, and lets the number/math lines eat their own pause by reading slow. Each sentence is anchored to a **visual event** in the spec, so when the MiniMax track lands you re-sync by either (a) nudging the read to ~150 wpm, or (b) bumping `durationSeconds` and scaling every keyframe `t` proportionally (all timings live in the spec + this table).

| Mv | # | sentence | words | start | end | visual anchor |
|----|---|----------|-------|-------|-----|---------------|
| 1 | 1 | How big is the biggest number you will ever need? | 10 | 0.6 | 4.7 | `BB(n)` faded in by 0.9 |
| 1 | 2 | Here is a game. | 4 | 5.0 | 6.6 | held |
| 1 | 3 | Take a machine with n rules … keep the one that runs longest. | 24 | 6.9 | 15.5 | held, camera creeps in |
| 1 | 4 | Call it BB of n. | 5 | 15.8 | 17.8 | `BB(n)` begins fade-out (17.8) |
| 2 | 5 | BB of five is forty-seven million. | 6 | 19.0 | 22.0 | value `grid` spawns (19.3) |
| 2 | 6 | We only proved that last year. | 6 | 22.4 | 24.4 | grid pulsing |
| 2 | 7 | BB of six … towers of them, then towers of those. | 21 | 24.5 | 33.0 | tower-a 25.3 → tower-b 28.6 → tower-c 31.6, breeding upward |
| 3 | 8 | And near seven hundred and forty-five rules, the number goes dark. | 11 | 34.0 | 39.0 | **negative-flash + collapse @ 38.87** |
| 3 | 9 | Not hard to find. Impossible. | 5 | 39.6 | 41.4 | over dim `BB` core |
| 3 | 10 | The axioms of mathematics cannot decide it. | 7 | 41.6 | 43.4 | core still, no fringe |
| 4 | 11 | There is a number math refuses to name. | 8 | 43.6 | 45.0 | core dimming |
| 4 | 12 | It was always there. | 4 | 45.2 | 46.0 | residual dot (in @ 44.9) |

`timeline.beats` accelerates through movement 2 (bars shorten as the towers breed) and **stops at 33.5 s**, so movements 3–4 go clinically still on their own — no beat pulse, no chromatic fringe (chromatic base is `0`, beat-only).

## Verification

- **check CLI passes:** `OK: 9 objects, 0 assets, 1380 frames`.
- **MP4 on disk:** `number-no-name.mp4` (4.8 MB), `ffprobe`-confirmed **h264, 720×1280 portrait, 1380 frames, duration = 46.000000**, silent (narration muxes later).
- **Four movement stills** pulled from the final spec and vision-inspected: (1) sparse legible `BB(n)` on clean warm-black with faint lattice; (2) escalating density — vermilion exponent towers climbing over the bone value grid; (3) single dim unlit `BB` after the flash, field collapsed, clinical; (4) lone dim glyph resolving to a residual dot. The negative-flash frame (t≈38.87) was confirmed as a near-full-frame bone flash.
- Deterministic: re-rendering the same spec yields the same 1380 frames.

## Findings / decisions

1. **`halftone` pass dropped (brief-intent honored over literal pass).** The `halftone` shader is a hard full-frame replacement with `rgbSplit` running three independent per-channel screens at different angles. On a sparse warm-black void it floods every cell edge with dots and moirés into a **saturated multicolor RGB mosaic** — precisely the cyan/rainbow "AI slop" the vibe-brief's palette rule forbids, and it erased the towers entirely in movement 2. There is no mix/opacity knob to make it a subtle "rosette on the void." So the CM-field lattice texture is delivered instead by the dim `void-lattice` clone-field grid (a real lattice that keeps the two-ink palette and crisp type). If a subtle print grain is wanted later, the pass needs a `mix`/`opacity` uniform — flagged for the renderer owner, out of scope here.
2. **`negative-flash` realized as a flash plane.** There is no invert/negative post pass in the toolkit, so the "single negative-flash" on "the number goes dark" is a full-frame bone plane (`collapse-flash`) spiking opacity to ~0.95 for ~3 frames — a hard flash-cut that masks the collapse match-cut to the dim core. Bloom (threshold 0.9) briefly lights it, which sharpens the punch.
3. **Sprite text can't roll (known limitation).** Text objects are `THREE.Sprite`, so `rotation.z` on text is a no-op. All motion is `scale`/`position` + a real **camera** dolly (`z 8.4 → 7.26`) and micro-roll (≤0.024 rad). No `rotation.z` track is placed on any text object.
4. **Camera position tracks are additive deltas.** Verified by probe: a `position.z` track **adds** to `camera.position.z`. So base position is `[0,0,0]` and the entire dolly lives in the track (absolute z). (Shipped specs that set both base z *and* a z track are effectively rendering ~2× farther — noted for the renderer owner.)
5. **Long portrait renders crash a single browser pass.** The 1380-frame single capture died (`Target closed`) around frame ~679 — GPU/texture churn (`renderFrame` rebuilds every object + `CanvasTexture` per frame). Since this scene has **no `feedback` pass**, each frame is a pure function of its index, so the final MP4 was rendered in three independent `--frame-range` chunks (browser relaunches between them, resetting memory) and the PNG sequences concatenated. Reproduced in the rerun commands below.

## Rerun commands (from repo root)

```sh
# validate
bun run --cwd packages/scene-renderer check -- --scene ../../workflows/scene-lab/specs/number-no-name.scene.json

# one movement still (e.g. the breeding towers)
bun run --cwd packages/scene-renderer render -- --scene ../../workflows/scene-lab/specs/number-no-name.scene.json --out ../../workflows/scene-lab/renders/number-no-name --still 31.0

# full 46 s render — chunked to survive the long-capture browser crash (no feedback pass ⇒ frame-accurate)
cd packages/scene-renderer
for r in 0-459 460-919 920-1379; do \
  bun src/render.ts --scene ../../workflows/scene-lab/specs/number-no-name.scene.json \
    --out /tmp/nnn-chunks/$r --runtime dist/runtime.js --frame-range $r --keep-frames; done
rm -rf /tmp/nnn-combined && mkdir -p /tmp/nnn-combined
for r in 0-459 460-919 920-1379; do cp /tmp/nnn-chunks/$r/frames/*.png /tmp/nnn-combined/; done
ffmpeg -y -framerate 30 -start_number 0 -i /tmp/nnn-combined/%06d.png \
  -c:v libx264 -pix_fmt yuv420p -movflags +faststart \
  ../../workflows/scene-lab/reports/2026-07-08-number-no-name-v1/number-no-name.mp4

# (when the narration WAV lands) mux it in a later pass, then re-sync per the timing table:
# ffmpeg -y -i number-no-name.mp4 -i narration.wav -c:v copy -c:a aac -shortest number-no-name-voiced.mp4
```
