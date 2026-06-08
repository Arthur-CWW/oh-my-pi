# Pipeline Serialization Format Plan

## Decision

Use **versioned JSON** for every machine-readable pipeline artifact:

- recipes
- campaign plans
- run manifests
- variant plans
- timeline/edit decision lists
- provider prompt cards
- review and scoring reports

Why:

- JSON keeps the first CLI simple and dependency-light.
- JSON is directly validatable with JSON Schema.
- Agents and scripts can read/write it without YAML parser edge cases.
- Human-facing text can still live in generated helper files such as `storyboard.md`, `script.txt`, and `captions.srt`.

No YAML in the first implementation. If a later UI wants comments or richer authoring, it can generate JSON as the canonical source of truth.

## Current Implementation

The first working CLI package is:

```txt
packages/ugc-cli/
```

Root scripts:

```bash
bun run ugc -- supercomputer modes
bun run ugc -- model list
bun run ugc -- arcads ugc-pack --product-name "Demo App" --variants 3 --wait
bun run ugc -- marketing-studio campaign --product-name "Demo App" --variants 4 --json
bun run ugc:typecheck
bun run ugc:test
```

Runtime output is ignored under:

```txt
data/ugc-cli/
  jobs/
    <job-id>.json
  runs/
    <campaign-id>/
      job.json
      campaign.json
      recipe.json
      manifest.json
      storyboard.md
      variants/
        variant-001/
          variant.json
          script.txt
          captions.srt
          timeline.json
          provider-prompts.json
```

The JSON files are the contract. The Markdown/text/SRT files are generated helpers.

## Core Objects

### Campaign Plan

`campaign.json` describes the full Arcads/Higgsfield-style UGC campaign:

```json
{
  "schemaVersion": "ugc.campaign/v1",
  "id": "demo-app-42b46932d6",
  "serialization": "json",
  "product": {
    "name": "Demo App",
    "url": "https://example.com",
    "description": "A lightweight planning app for overloaded founders.",
    "approvedClaims": ["saves planning time"],
    "forbiddenClaims": ["fake customer testimonial"]
  },
  "formats": ["talking_head_product_cutaway", "show_app_creator"],
  "variants": []
}
```

### Recipe

`recipe.json` is the executable graph skeleton. It is intentionally simple:

```json
{
  "schemaVersion": "ugc.recipe/v1",
  "id": "demo-app-42b46932d6",
  "name": "Demo App UGC Campaign",
  "matrix": {
    "variants": 3,
    "formats": ["talking_head_product_cutaway", "show_app_creator"],
    "personas": ["bedroom_creator", "founder_operator"],
    "hookStyles": ["pain_point", "skeptical_testimonial"]
  },
  "graph": [
    {
      "id": "product_brief",
      "kind": "product.normalize",
      "provider": "local",
      "needs": [],
      "input": {},
      "output": { "product": "product.json" }
    },
    {
      "id": "caption_sidecars",
      "kind": "subtitle.generate",
      "provider": "local",
      "needs": ["script_variants"],
      "input": { "format": "srt", "renderReadableTextInPost": true },
      "output": { "captions": "variants/*/captions.srt" }
    }
  ],
  "render": {
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "aspectRatio": "9:16"
  }
}
```

### Variant Plan

Each `variants/<id>/variant.json` records the editable creative slots:

```json
{
  "id": "variant-001",
  "formatId": "talking_head_product_cutaway",
  "persona": {
    "id": "bedroom_creator",
    "consentStatus": "synthetic"
  },
  "script": {
    "hook": "If this workflow is still manual...",
    "body": "Cut from the creator to the product proof...",
    "cta": "Try it from the link."
  },
  "assetsNeeded": [
    {
      "kind": "video",
      "role": "broll",
      "providerPreference": ["jimeng", "kie", "fal", "local-still-motion"]
    }
  ],
  "compliance": {
    "syntheticPersona": true,
    "needsAiDisclosure": true,
    "blockedClaims": []
  }
}
```

### Timeline

Each `timeline.json` is a JSON edit decision list:

```json
{
  "schemaVersion": "ugc.timeline/v1",
  "variantId": "variant-001",
  "width": 1080,
  "height": 1920,
  "fps": 30,
  "layers": [
    {
      "id": "base_talking_clip",
      "type": "video",
      "role": "talking_or_voiceover_clip",
      "startMs": 0,
      "endMs": 24000,
      "source": "provider_prompt_cards.json#talking_or_voiceover_clip"
    },
    {
      "id": "captions",
      "type": "subtitle",
      "role": "captions",
      "source": "captions.srt"
    }
  ]
}
```

### Run Manifest

`manifest.json` is the immutable run record:

```json
{
  "schemaVersion": "ugc.run/v1",
  "serialization": "json",
  "status": "completed",
  "cost": {
    "estimatedUsd": 0,
    "actualUsd": 0,
    "paidGenerationSubmitted": false
  },
  "guardrails": {
    "noPaidGeneration": true,
    "noAutoposting": true,
    "noRealPersonClone": true,
    "noModelRenderedText": true
  }
}
```

## Component Mapping

The CLI-first open-source analogue breaks Arcads/Higgsfield into these parts:

| Component | Current JSON artifact | Future executable node |
|---|---|---|
| Product intake | `campaign.json.product` | `product.normalize`, `web.fetch`, `screenshot.capture` |
| Format/template selection | `recipe.json.matrix.formats` | `format.instantiate` |
| Persona/actor selection | `variant.json.persona` | `persona.select`, `image.generate` |
| Script/hook variants | `variant.json.script` | `script.generate` |
| Voice/TTS | `provider-prompts.json` | `tts.generate` |
| Talking actor/lipsync | `provider-prompts.json` | `video.lipsync` |
| B-roll/product/app scenes | `provider-prompts.json` | `video.generate`, `app.capture` |
| Captions/text | `captions.srt`, `timeline.json` | `subtitle.generate`, `render.compose` |
| Final render | `timeline.json` | `remotion.render`, `ffmpeg.finalize` |
| Scoring/review | `virality-report.json` | `analyze.creative`, `review.score` |

## Provider Policy

Provider adapters should remain pluggable. The JSON graph records capability and preference; it does not care whether the eventual media comes from Jimeng, Kie, fal, OpenAI, Gemini, local ComfyUI, or a manual asset.

First provider posture:

```json
{
  "node": "broll",
  "capability": "video.generate",
  "preferred": ["jimeng", "kie", "fal", "veo", "kling"],
  "localFallback": "still image motion / storyboard placeholder"
}
```

Hard defaults:

- no paid generation unless explicitly enabled by a future flag
- no real-person clone path without consent metadata
- no readable text delegated to image/video models
- no direct autoposting in the first pipeline

## Next Implementation Steps

1. Add JSON Schema files for `ugc.recipe/v1`, `ugc.campaign/v1`, `ugc.timeline/v1`, and `ugc.run/v1`.
2. Add a `ugc recipe validate` implementation backed by the schemas instead of the current lightweight shape check.
3. Add provider adapter interfaces that consume `provider-prompts.json` and write output asset records.
4. Add a renderer command that consumes `timeline.json` and emits a first simple MP4 through Remotion or ffmpeg.
5. Add an asset catalog table so generated JSON artifacts can be indexed by product, variant, persona, format, provider, and provenance.
