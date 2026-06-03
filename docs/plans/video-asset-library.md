# Video Asset Library and Metadata DB Plan

## Goal

Create a centralized, queryable catalog of composable video assets: characters, props, overlays, backgrounds, loops, masks, captions, sounds, and generated variants.

This is the asset layer underneath the workflow graph. The final video is less important than building a reusable library of editable components.

## Core idea

Assets should be stored like video-editor layers / ComfyUI nodes, not opaque final renders.

Examples:

- character: talking seal host, AI influencer persona, mascot
- prop: dangling keys, product package, rocket, chart, phone UI
- overlay: math rain, meme stamp, glitch, caption frame, brainrot sparkle
- background: podcast room, office, cold cyber city, surreal whiteboard
- audio: TTS voice, laugh sting, notification sound, room tone
- masks: mouth mask, character matte, foreground occluder

## Metadata DB

Use SQLite for a central local catalog.

Schema:

```txt
docs/schemas/video-asset-catalog-v0.sql
```

Recommended runtime path:

```txt
data/asset-catalog/assets.sqlite
```

The DB tracks:

- asset identity, file path, dimensions, duration, alpha/loopability
- variants: preview MP4, alpha MOV/WebM, PNG sequence, thumbnail, mask
- generation provider/model/operation/run ID
- prompts in original language and optional translation
- tags with namespaces/categories
- vibe axes and scores
- provenance/source references
- relationships between assets
- workflow usage records

## Why tags are not enough

Semantic tags help search, but the pipeline also needs preverbal/vibe metadata: affective, memetic, and compositional signals that are hard to express as plain meaning.

So the catalog separates:

- **semantic tags**: `seal`, `keys`, `rocket`, `chart`
- **culture/meme tags**: `抽象`, `电子木鱼`, `内卷`, `赛博打工人`, `brainrot`
- **composition tags**: `foreground-overlay`, `loopable`, `alpha`, `caption-safe-bottom`
- **motion tags**: `swing`, `pulse`, `rain`, `float`, `jitter`
- **vibe axes**: scores like `agency-anxiety=0.9`, `cute-menace=0.6`

## Initial vibe axes

Suggested axes for the first catalog:

| Axis | Low | High |
|---|---|---|
| `agency-anxiety` | calm/static | dangling-choice-panic |
| `post-labor-dread` | neutral | automation-ate-my-future |
| `absurd-bureaucracy` | clean | stamped/formal/ridiculous |
| `market-ritual` | non-financial | charts/rockets/number-go-up cult |
| `cute-menace` | cute | cute but spiritually threatening |
| `brainrot-density` | tasteful | maximal overstimulus |
| `caption-interference` | safe empty space | conflicts with subtitles |

## Composeability rules

Prefer assets that are:

- alpha-capable or maskable
- loopable
- short, 2–6 seconds
- standalone and remixable
- registered with tags/prompts
- exported with a small preview and a high-quality/alpha variant
- not dependent on generated readable text unless the text is local/post-rendered

For video overlays, useful variant set:

```txt
<asset>/thumbnail.png
<asset>/preview.mp4          # easy to inspect, no alpha guarantee
<asset>/alpha.mov            # ProRes 4444 alpha or equivalent
<asset>/frames/*.png         # source frames, transparent if needed
```

## First stage to prototype

Stage:

```txt
asset.prop_overlay.generate_brainrot_pack_v0
```

Purpose:

Create stupid/fun, composable brainrot props and overlays that can be layered over many videos:

1. dangling keys of agency
2. rocket/chart market ritual
3. Chinese abstract meme stamp pulse
4. math/Chinese glyph rain
5. optional future: electronic wooden fish, sad frog paperwork, hukou QR portal, cyber steamed bun, attention-slot machine

These do not need heavy sync with speech. They are perfect parallel assets while Jimeng/TTS/lipsync research continues.

## Example asset record

```yaml
id: brainrot-v0.dangling-keys-of-agency
kind: video
stageRole: prop_overlay_loop
compositingRole: foreground_alpha
loopable: true
hasAlpha: true
tags:
  semantic: [keys, choice, ownership]
  meme: [brainrot, dangling-keys]
  vibe: [agency-anxiety, permanent-underclass]
  motion: [swing, shimmer]
vibeScores:
  agency-anxiety: 0.95
  post-labor-dread: 0.55
  brainrot-density: 0.65
prompt:
  language: en+zh
  text: >
    Procedural transparent overlay loop: shiny dangling keys hypnotically swing in front
    of a cold post-labor talking-head scene; vibes of agency anxiety, ownership tokens,
    and baby-sensory brainrot; no model-rendered subtitles.
```

## How this connects to pipeline recipes

A recipe should reference catalog assets by ID:

```yaml
assets:
  seal_character:
    uri: asset://character/seal-host-v1
  dangling_keys:
    uri: asset://brainrot-v0.dangling-keys-of-agency

stages:
  - id: compose_brainrot_layers
    kind: scene.compose
    input:
      baseVideo: $outputs.generate_visual.video
      layers:
        - asset: asset://brainrot-v0.dangling-keys-of-agency
          z: 20
          position: top-right
          opacity: 0.8
        - asset: asset://brainrot-v0.market-ritual-rocket-chart
          z: 5
          position: background
          blendMode: screen
```

## Next implementation steps

1. Create the SQLite DB from `docs/schemas/video-asset-catalog-v0.sql`.
2. Generate a tiny local procedural brainrot overlay pack under `data/assets/brainrot-props-v0/`.
3. Register assets, prompts, tags, and vibe scores in `data/asset-catalog/assets.sqlite`.
4. Later, add a TS/CLI catalog browser/searcher.
5. Later, let Jimeng/ComfyUI/TTS/lipsync provider nodes write into the same DB.
