# Reference Profile Remix View Spec

ImageGen failed twice while generating this screen on 2026-06-09, so this is the saved implementation spec until a raster reference can be generated.

## Goal

Design a workspace view for decomposing a public or rights-cleared TikTok/UGC/faceless profile into reusable mechanics, then swapping in a synthetic persona, new voice, product, hook copy, CTA, and rendered captions.

## Layout

Use the same native agent-workbench style as the other workspace views:

- light off-white shell
- compact Mac-like toolbar
- pale two-section left sidebar
- thin borders
- small restrained typography
- sparse blue/green accent
- no decorative gradients, no marketing hero, no onboarding cards

## Primary Regions

### Left Sidebar

Two sections:

- Workspace: Persona Atlas, Exploration Board, Batch Review, Campaign Map, Reference Remix, Final Editor, Developer Graph
- Libraries: Profiles, Formats, Hooks, Captions, Voices, Products

### Center Header

Profile archive summary:

```txt
Reference profile: @sample_creator
Rights: rights-cleared / public reference / user-owned
Videos indexed: 42
Selected samples: 9
Purpose: extract mechanics, not identity
```

### Sample Browser

Vertical video thumbnails with:

- play button
- duration
- selected checkbox
- sample role tags: hook, transition, CTA, non-CTA, beauty shot, product demo, b-roll
- quick flick controls for moving through many examples

### Pose / Timing Extraction

Timeline tracks:

- gesture beats
- camera framing
- cut rhythm
- pose/keyframe transfer
- caption safe area
- hook slot
- CTA slot

This is the ComfyUI-ish information, but presented as a creative extraction board rather than raw node graph.

### Preserve Vs Swap Panel

Preserve:

- pose timing
- gesture rhythm
- shot rhythm
- template grammar
- caption layout mechanics
- posting strategy

Swap:

- recognizable face/body identity
- voice
- exact phrasing
- product/demo/proof slot
- hook copy
- CTA
- rendered captions/text

### Right Inspector

Tabs:

- Style Bible
- Pose
- Hooks
- JSON

Default Style Bible fields:

- niche
- energy
- speaking style
- visual references
- posting strategy
- non-CTA posts
- CTA tests
- rights / allowed use

JSON tab should expose the same data as a versioned manifest.

### Bottom Agent Command Bar

Example command:

```txt
Extract pose/timing from selected samples and generate 8 variants with Lena Park persona.
```

Context chips:

- 9 samples selected
- preserve pose/timing
- swap voice
- use skincare product brief
- render captions locally

## Safety / Product Boundary

Do not make this an identity clone UI. It is a format/profile mechanics extraction UI.

The interface should always make the preserved vs swapped boundary visible.
