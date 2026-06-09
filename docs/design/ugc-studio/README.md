# UGC Studio Design Directions

Native `imagegen` directions generated on 2026-06-09 for the Arcads/Higgsfield-style open-source UGC website demo.

Style/state doc:

- `docs/state/ugc-studio-style-direction.md`

## Files

- `01-dark-canvas-editor.png` — Figma-like dark canvas with vertical video artboards, floating prompt, modal settings, and bottom layer timeline.
- `02-open-light-canvas.png` — more open-ended light canvas with loose editable primitives, prompt command surface, layer stack, and asset library modals.
- `03-video-layer-editor.png` — video editor first: selected 9:16 composition, dense layer timeline, floating prompt, and generate-layer modal with JSON preview.
- `04-recents-command-home.png` — Figma-recents inspired project home with campaign thumbnails and a command prompt for new editable ad systems.

## Direction Chosen For Demo

The implemented `/ugc-studio/` route pulls mostly from `01-dark-canvas-editor.png` and `03-video-layer-editor.png`: open canvas, vertical ad artboards, floating prompt/workspace, modal secondary menus, and a persistent video layer timeline.

## Recovered Imagegen Cache

All locally recovered generated concepts from the expensive prior imagegen pass are preserved under `recovered/`.

- `recovered/contact-sheet-labeled.png` — overview of all recovered generated images.
- `recovered/generated-01.png` — dark final layer editor; strongest existing layer/timeline direction.
- `recovered/generated-02.png` — light open canvas with loose primitives.
- `recovered/generated-03.png` — dark editor with developer/provider modal.
- `recovered/generated-04.png` — recents/project home direction; useful information architecture but too dark/constrained.
- `recovered/generated-05.png` — tabular UGC workbench; useful only as an admin/data view.
- `recovered/generated-06.png` — ComfyUI-like developer graph mode.
- `recovered/generated-07.png` — batch review surface; useful workflow, weak visual style.
- `recovered/generated-08.png` and `recovered/generated-09.png` — CLI bridge/admin package views.

Reference images:

- `references/chorus-screenshot.png` — Melty Labs Chorus screenshot, used for the native agent-workbench style direction.
- `references/abg-cmo-korean-beauty-flow-reference.png` — weak reference for the K-pop/Korean-beauty influencer genre and onboarding example Arthur pasted. Do not use this as the main product UX model.

## Canonical Workspace View Pass

The newer view set under `workspace-views/` is the strongest current UX direction:

- `workspace-views/01-persona-atlas.png`
- `workspace-views/02-exploration-board.png`
- `workspace-views/03-batch-review-player.png`
- `workspace-views/04-campaign-branch-map.png`

Use those with `recovered/generated-01.png` for final layer editing and `recovered/generated-06.png` for developer graph mode.
