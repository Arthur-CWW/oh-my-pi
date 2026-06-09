# UGC Studio Workspace Views

Generated with native ImageGen on 2026-06-09 after reframing the product around persona/profile exploration, batch review, branch history, and final layer editing.

Style reference:

- `../../../../docs/state/ugc-studio-style-direction.md`
- `../references/chorus-screenshot.png`

## Files

- `01-persona-atlas.png` — canonical whole-persona/profile collection view. Strong reference for left navigation, persona cards, selected persona inspector, continuity JSON, agent critique, and bottom command bar.
- `02-exploration-board.png` — canonical babble-and-prune board. Strong reference for progressive workflow stages with flickable examples and selected branch inspector.
- `03-batch-review-player.png` — canonical fast review surface. Strong reference for large selected playable candidate, surrounding variant strip, metrics/notes inspector, candidate table, and selected-set command bar.
- `04-campaign-branch-map.png` — canonical snapshot/fork history view. Strong reference for creative branch graph, checkpoint nodes, selected snapshot preview tray, rollback/fork actions, and metrics deltas.
- `contact-sheet.png` — four-view overview.
- `05-reference-profile-remix-spec.md` — saved spec for the reference-profile remix view. ImageGen failed twice for this screen on 2026-06-09, so implementation should use the spec until a raster view is generated.

## How These Relate To Recovered Concepts

- Keep `../recovered/generated-01.png` as the final layer editor reference.
- Keep `../recovered/generated-06.png` as the developer graph reference.
- Treat `../recovered/generated-07.png` as an older batch-review IA reference superseded by `03-batch-review-player.png`.

## Implementation Implication

The main app should not start in the timeline editor. It should start in a workspace shell where users can switch focus between persona atlas, exploration board, batch review, campaign map, final editor, and developer graph. The agent command bar should persist across these views and apply actions to selected candidates, branches, or snapshots.
