# Slotok reference assets

Local provider inspiration manifests live under `data/ugc-studio/reference-assets/` and are imported through the existing dry-run-first routes:

- `POST /api/ugc/reference-catalog/plan`
- `POST /api/ugc/reference-catalog/import`

Payloads may pass `manifestPaths` for provider manifests, e.g. `data/ugc-studio/reference-assets/higgsfield/manifest.json` and `data/ugc-studio/reference-assets/arcads/manifest.json`. The importer reads manifest JSON only; it does not open or copy media bytes.

## Manifest summary

| Provider | Manifest | Listed assets | Blocked/metadata-only assets | Failed downloads/evidence | Provenance summary |
| --- | --- | ---: | ---: | ---: | --- |
| Higgsfield | `data/ugc-studio/reference-assets/higgsfield/manifest.json` | 58 listed, 57 downloaded | 6 blocked | 1 failed | Public landing/app-gallery assets from Higgsfield marketing pages. Manifest says no license grant or Terms page was confirmed. |
| Arcads | `data/ugc-studio/reference-assets/arcads/manifest.json` | 21 listed | 7 blocked | 1 failed, 1 evidence file | Public marketing-page assets from Arcads pages. Manifest notes Arcads/FRESHR terms treat platform content as FRESHR property and restrict Video Model extraction/reuse without authorization. |

## Rights guardrails

- Current provider manifest imports store `sourcePolicy: metadata-only`.
- Current Higgsfield and Arcads entries are `referenceOnly: true` and `directGenerationInput: false`; future manifests must explicitly set a direct-generation allowance before any asset can flip those flags.
- Store local paths, source pages, asset URLs, byte/hash metadata, rights notes, and provenance only.
- Do not feed these assets directly into generation, training, actor cloning, or redistributable output.
- Any creative use must be clean-room: abstract mechanics only, with new product visuals, actors/personas, voice, copy, captions, brand marks, and audio.
