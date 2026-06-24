# ASMR Companion + Seedance Goal 6 final handoff — 2026-06-24

This is the reviewer-facing closeout for Goals 2–5 plus the final Goal 6 proof inventory. It is intentionally biased toward fast inspection, stable local paths, and exact rerun order.

## Changed files

- `docs/qa/asmr-companion-goal6-final-handoff-20260624.md`
- `docs/qa/asmr-companion-goal6-artifact-inventory-20260624.json`
- Goal 6 commit hash: none created in this handoff

## What to review first

1. `data/asmr-companion/goal5-pipeline-proof/reviewer-report.html`
   - Fastest human-readable proof that Goal 5 wired Goal 4 + Goal 2 + Goal 3 together and rendered a visible placeholder for the missing Seedance MP4.
2. `data/asmr-companion/goal5-pipeline-proof/remotion-render/recreate.mp4`
   - Real rendered MP4 output from Goal 5. Important caveat: the first clip is a placeholder because Goal 2 did not produce a live Seedance MP4.
3. `data/asmr-companion/goal5-pipeline-proof/goal5-workflow-handoff.json`
   - Top-level Goal 5 handoff with exact materialize/render commands and the media-readiness flags.
4. `data/asmr-companion/goal2/seedance-parent-proof/normalized/generated-video-clips.v1.json`
   - Explains why Goal 5 had to use a placeholder: `dryRun: true`, planned MP4 path only, no local provider video.
5. `data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.wav`
   - Real audio proof consumed by Goal 5.
6. `data/asmr-companion/goal4-planning/goal4-pipeline-handoff.bundle.json`
   - Prompt/motion/caption handoff bundle that fed Goal 5.

## Implemented now

| Goal | Implemented now | Primary proof artifact(s) | Status |
|---|---|---|---|
| 2 | Seedance first-frame dry-run planner, generated-clips manifest, conditioning sidecar shape, runbook, and provider-swap-ready planned MP4 path | `data/asmr-companion/goal2/seedance-parent-proof/normalized/generated-video-clips.v1.json`, `docs/qa/asmr-seedance-goal2-runbook-20260624.md` | Implemented as dry-run only in the accepted proof bundle |
| 3 | Deterministic spatial/binaural audio renderer output with render manifest | `data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.wav`, `data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.render-output.json` | Real media produced |
| 4 | Pleometric planning + Goal 5 handoff bundle with prompt strings, motion prompts, caption plan, and upstream manifest refs | `data/asmr-companion/goal4-planning/goal4-pipeline-handoff.bundle.json` | Implemented |
| 5 | Goal 4 → Goal 5 materialization, resolved generated-clip handling, Remotion render, HyperFrames project bundle, reviewer HTML, and explicit missing-media placeholder behavior | `data/asmr-companion/goal5-pipeline-proof/goal5-workflow-handoff.json`, `data/asmr-companion/goal5-pipeline-proof/reviewer-report.html` | Implemented; video lane still placeholder-backed |
| 6 | Final reviewer handoff doc + artifact inventory | `docs/qa/asmr-companion-goal6-final-handoff-20260624.md`, `docs/qa/asmr-companion-goal6-artifact-inventory-20260624.json` | Implemented |

## Verified by root commands

Accepted upstream commits and root-run verification:

| Goal | Commit(s) | Root-ran commands | Proof/output root |
|---|---|---|---|
| 1 (prereq) | `1d4228fa` | `cd packages/media-contracts && bun run typecheck`  
`cd packages/media-contracts && bun test test/fixture-validation.test.ts` | `packages/media-contracts/fixtures/` |
| 2 | `3f2b1b49` | `cd packages/jimeng-client && bun test ./test/seedance-image2video-plan.test.ts`  
`cd packages/jimeng-client && bun run typecheck`  
`[INFERENCE] bun packages/jimeng-client/src/browser-proxy-cli.ts seedance-image2video-plan --prompt "Original ASMR companion raises one hand under moonlit server shrine glow, no text" --firstFrameUri tos://fixture/seedance/first-frame-candidate-001.png --firstFrameHash aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --runId seedance-parent-proof-001 --createdAt 2026-06-24T00:00:00.000Z --seed 2026062401 --durationSec 5 --ratio 9:16 --outDir data/asmr-companion/goal2/seedance-parent-proof` | `data/asmr-companion/goal2/seedance-parent-proof/` |
| 3 | `57182f28` | `cd packages/spatial-audio-renderer && bun run typecheck`  
`cd packages/spatial-audio-renderer && bun test test/render.test.ts`  
`bun packages/spatial-audio-renderer/src/cli.ts render --voice-assets packages/media-contracts/fixtures/valid/voice-assets.v1.json --stems packages/spatial-audio-renderer/fixtures/asmr-scene/asmr-stems.v1.json --spatial packages/spatial-audio-renderer/fixtures/asmr-scene/spatial-audio-manifest.v1.json --outDir data/asmr-companion/goal3-spatial-proof` | `data/asmr-companion/goal3-spatial-proof/` |
| 4 | `4e40f278`, `0a245e31` | `cd packages/pleometric-planner && bun run typecheck`  
`cd packages/pleometric-planner && bun test ./test/planner.test.ts`  
`bun packages/pleometric-planner/src/cli.ts build-handoff --card packages/pleometric-planner/fixtures/cards/asmr-companion-moonlit.card.json --card packages/pleometric-planner/fixtures/cards/high-aura-orbit.card.json --generated-clips data/asmr-companion/goal2/seedance-parent-proof/normalized/generated-video-clips.v1.json --spatial-render-output data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.render-output.json --out data/asmr-companion/goal4-planning/goal4-pipeline-handoff.bundle.json` | `data/asmr-companion/goal4-planning/goal4-pipeline-handoff.bundle.json` |
| 5 | `8b529e61` | `bun workflows/tiktok-recreate/goal5-asmr-handoff.ts --handoff data/asmr-companion/goal4-planning/goal4-pipeline-handoff.bundle.json --generated-clips data/asmr-companion/goal2/seedance-parent-proof/normalized/generated-video-clips.v1.json --spatial-render-output data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.render-output.json --outDir data/asmr-companion/goal5-pipeline-proof --createdAt 2026-06-24T00:00:00.000Z --proofId goal5-asmr-seedance-render-proof-001`  
`bun test workflows/tiktok-recreate/goal5-asmr-handoff.test.ts`  
`bun run remotion-renderer:render -- --manifest data/asmr-companion/goal5-pipeline-proof/remotion-context.json --layer-plan data/asmr-companion/goal5-pipeline-proof/goal5-layer-plan.json --persona-manifest data/asmr-companion/goal5-pipeline-proof/persona-manifest.json --out data/asmr-companion/goal5-pipeline-proof/remotion-render --audio-manifest data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.render-output.json --generated-clips-manifest data/asmr-companion/goal2/seedance-parent-proof/normalized/generated-video-clips.v1.json`  
`bun run tiktok-recreate:hyperframes -- --layer-plan data/asmr-companion/goal5-pipeline-proof/goal5-layer-plan.json --out data/asmr-companion/goal5-pipeline-proof/hyperframes --audio data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.wav` | `data/asmr-companion/goal5-pipeline-proof/` |

Notes:

- Goal 2’s exact saved proof command was not preserved verbatim in the proof directory; the command above is reconstructed from the saved artifact fields plus the CLI’s documented argument shape.
- Goal 1 is listed here as an accepted prerequisite because the full reviewer rerun order starts at the contract spine, even though the artifact inventory below stays focused on Goal 2–5 outputs.

## What root actually ran and what produced artifacts
- Goal 1 root run revalidated the contract spine and shared fixtures under `packages/media-contracts/fixtures/`; it is a prerequisite acceptance, not part of the Goal 2–5 artifact inventory below.

- Goal 2 root run produced the dry-run proof folder `data/asmr-companion/goal2/seedance-parent-proof/`, including `generated-video-clips.v1.json`, the dry-run request plan, the response placeholder, and the conditioning sidecar shape. It did **not** produce a local Seedance MP4.
- Goal 3 root run produced real media at `data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.wav` plus `goal3-close-whisper-binaural.render-output.json`.
- Goal 4 root run produced `data/asmr-companion/goal4-planning/goal4-pipeline-handoff.bundle.json`.
- Goal 5 root run produced `data/asmr-companion/goal5-pipeline-proof/`, including `reviewer-report.html`, `goal5-workflow-handoff.json`, `goal5-layer-plan.json`, `generated-clips.resolved.json`, the placeholder SVG, a real Remotion MP4 at `remotion-render/recreate.mp4`, and a HyperFrames project bundle under `hyperframes/`.
- Goal 6 adds only reviewer-facing handoff artifacts under `docs/qa/`; it does not introduce new media generation.

## Artifact inventory (stable local paths)

A machine-readable inventory also lives at `docs/qa/asmr-companion-goal6-artifact-inventory-20260624.json`.

| Goal | Path | Why it matters | Artifact state |
|---|---|---|---|
| 2 | `docs/qa/asmr-seedance-goal2-runbook-20260624.md` | Goal 2 operator split: dry-run vs live/preflight | Documentation |
| 2 | `data/asmr-companion/goal2/seedance-parent-proof/raw/seedance-parent-proof-001-dry-run-plan.json` | Direct no-spend request-body proof | Dry-run JSON |
| 2 | `data/asmr-companion/goal2/seedance-parent-proof/normalized/seedance-parent-proof-001-summary.json` | Reviewer summary of the accepted Goal 2 proof | Dry-run JSON |
| 2 | `data/asmr-companion/goal2/seedance-parent-proof/normalized/seedance-parent-proof-001-first-frame-conditioning.json` | First-frame conditioning sidecar path/shape | Dry-run JSON |
| 2 | `data/asmr-companion/goal2/seedance-parent-proof/normalized/generated-video-clips.v1.json` | Downstream manifest consumed by Goals 4 and 5 | Dry-run manifest |
| 3 | `data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.wav` | Real rendered audio consumed downstream | Real media |
| 3 | `data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.render-output.json` | Audio manifest with hash, duration, channels, source manifests | Real generated JSON |
| 4 | `data/asmr-companion/goal4-planning/goal4-pipeline-handoff.bundle.json` | Goal 5’s creative/planning source of truth | Real generated JSON |
| 5 | `data/asmr-companion/goal5-pipeline-proof/reviewer-report.html` | Fastest reviewer-facing summary | Real generated HTML |
| 5 | `data/asmr-companion/goal5-pipeline-proof/goal5-workflow-handoff.json` | Top-level handoff and rerun commands | Real generated JSON |
| 5 | `data/asmr-companion/goal5-pipeline-proof/goal5-layer-plan.json` | Confirms the clip lane is `deterministic-placeholder` | Real generated JSON |
| 5 | `data/asmr-companion/goal5-pipeline-proof/generated-clips.resolved.json` | Records `mediaAvailable: false` and placeholder fallback | Real generated JSON |
| 5 | `data/asmr-companion/goal5-pipeline-proof/media/first-frame-candidate-seedance-dry-run.placeholder.svg` | Visible placeholder standing in for missing Goal 2 MP4 | Deterministic placeholder media |
| 5 | `data/asmr-companion/goal5-pipeline-proof/remotion-render/recreate.mp4` | Real rendered MP4 output for review | Real media containing placeholder clip |
| 5 | `data/asmr-companion/goal5-pipeline-proof/remotion-render/manifest.json` | Records generated-clips input and missing-media reason | Real generated JSON |
| 5 | `data/asmr-companion/goal5-pipeline-proof/hyperframes/index.html` | Openable HyperFrames project output | Real generated HTML project |
| 5 | `data/asmr-companion/goal5-pipeline-proof/hyperframes/manifest.json` | Confirms HyperFrames bundle exists but `renderRan=false` | Real generated JSON project |

## Real media vs placeholders / dry-run artifacts

### Real media produced now

- `data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.wav`
- `data/asmr-companion/goal5-pipeline-proof/remotion-render/recreate.mp4`

### Real generated artifacts, but not final media

- `data/asmr-companion/goal4-planning/goal4-pipeline-handoff.bundle.json`
- `data/asmr-companion/goal5-pipeline-proof/goal5-workflow-handoff.json`
- `data/asmr-companion/goal5-pipeline-proof/reviewer-report.html`
- `data/asmr-companion/goal5-pipeline-proof/hyperframes/index.html`
- `data/asmr-companion/goal5-pipeline-proof/hyperframes/manifest.json`

### Deterministic placeholders / dry-run only

- All accepted Goal 2 proof outputs under `data/asmr-companion/goal2/seedance-parent-proof/`
- `data/asmr-companion/goal5-pipeline-proof/media/first-frame-candidate-seedance-dry-run.placeholder.svg`
- The Goal 5 generated-clip lane in `data/asmr-companion/goal5-pipeline-proof/goal5-layer-plan.json`, which records `mode: "deterministic-placeholder"`

## Exact rerun order for a human reviewer

1. Goal 1 prerequisite
   - `cd packages/media-contracts && bun run typecheck`
   - `cd packages/media-contracts && bun test test/fixture-validation.test.ts`
2. Goal 2
   - `cd packages/jimeng-client && bun test ./test/seedance-image2video-plan.test.ts`
   - `cd packages/jimeng-client && bun run typecheck`
   - `[INFERENCE] bun packages/jimeng-client/src/browser-proxy-cli.ts seedance-image2video-plan --prompt "Original ASMR companion raises one hand under moonlit server shrine glow, no text" --firstFrameUri tos://fixture/seedance/first-frame-candidate-001.png --firstFrameHash aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --runId seedance-parent-proof-001 --createdAt 2026-06-24T00:00:00.000Z --seed 2026062401 --durationSec 5 --ratio 9:16 --outDir data/asmr-companion/goal2/seedance-parent-proof`
3. Goal 3
   - `cd packages/spatial-audio-renderer && bun run typecheck`
   - `cd packages/spatial-audio-renderer && bun test test/render.test.ts`
   - `bun packages/spatial-audio-renderer/src/cli.ts render --voice-assets packages/media-contracts/fixtures/valid/voice-assets.v1.json --stems packages/spatial-audio-renderer/fixtures/asmr-scene/asmr-stems.v1.json --spatial packages/spatial-audio-renderer/fixtures/asmr-scene/spatial-audio-manifest.v1.json --outDir data/asmr-companion/goal3-spatial-proof`
4. Goal 4
   - `cd packages/pleometric-planner && bun run typecheck`
   - `cd packages/pleometric-planner && bun test ./test/planner.test.ts`
   - `bun packages/pleometric-planner/src/cli.ts build-handoff --card packages/pleometric-planner/fixtures/cards/asmr-companion-moonlit.card.json --card packages/pleometric-planner/fixtures/cards/high-aura-orbit.card.json --generated-clips data/asmr-companion/goal2/seedance-parent-proof/normalized/generated-video-clips.v1.json --spatial-render-output data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.render-output.json --out data/asmr-companion/goal4-planning/goal4-pipeline-handoff.bundle.json`
5. Goal 5
   - `bun workflows/tiktok-recreate/goal5-asmr-handoff.ts --handoff data/asmr-companion/goal4-planning/goal4-pipeline-handoff.bundle.json --generated-clips data/asmr-companion/goal2/seedance-parent-proof/normalized/generated-video-clips.v1.json --spatial-render-output data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.render-output.json --outDir data/asmr-companion/goal5-pipeline-proof --createdAt 2026-06-24T00:00:00.000Z --proofId goal5-asmr-seedance-render-proof-001`
   - `bun test workflows/tiktok-recreate/goal5-asmr-handoff.test.ts`
   - `bun run remotion-renderer:render -- --manifest data/asmr-companion/goal5-pipeline-proof/remotion-context.json --layer-plan data/asmr-companion/goal5-pipeline-proof/goal5-layer-plan.json --persona-manifest data/asmr-companion/goal5-pipeline-proof/persona-manifest.json --out data/asmr-companion/goal5-pipeline-proof/remotion-render --audio-manifest data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.render-output.json --generated-clips-manifest data/asmr-companion/goal2/seedance-parent-proof/normalized/generated-video-clips.v1.json`
   - `bun run tiktok-recreate:hyperframes -- --layer-plan data/asmr-companion/goal5-pipeline-proof/goal5-layer-plan.json --out data/asmr-companion/goal5-pipeline-proof/hyperframes --audio data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.wav`

## Blockers / caveats

- Goal 2 is still dry-run in the accepted proof bundle. The planned MP4 path is `data/asmr-companion/goal2/seedance-parent-proof/artifacts/seedance-parent-proof-001.mp4`, but no local MP4 exists there.
- Goal 5 therefore renders a visible placeholder instead of a real Seedance MP4. This is explicit in:
  - `data/asmr-companion/goal5-pipeline-proof/generated-clips.resolved.json` (`mediaAvailable: false`)
  - `data/asmr-companion/goal5-pipeline-proof/goal5-layer-plan.json` (`mode: "deterministic-placeholder"`)
  - `data/asmr-companion/goal5-pipeline-proof/reviewer-report.html`
- The accepted Goal 2 sample is not a positive SynthID-marked conditioning example: `data/asmr-companion/goal2/seedance-parent-proof/normalized/seedance-parent-proof-001-summary.json` records `synthid_marked: false` and `conditioning_applied: false`.
- The Goal 5 HyperFrames output is a project bundle, not a rendered MP4 in this proof root. `data/asmr-companion/goal5-pipeline-proof/hyperframes/manifest.json` records `renderRan: false` and `audioAttached: false`.
- The Goal 5 Remotion MP4 is reviewable output, but it is not proof of a live Seedance generation lane; it is proof that the pipeline composes correctly around a missing generated clip.

## Exploratory / next-phase work not implemented here

- Replace the Goal 2 dry-run manifest with a real Goal 2 live Seedance submit/poll/download artifact, then rerun Goal 5 against the updated `generated-video-clips.v1.json`.
- `T-2026-06-24-002`: design the Pleometric artifact library and ASMR universe system. That is the next workstream, not part of this completion pass.
- Realtime Airi-like companion runtime remains backlog after Goals 3, 5, and 6 proof; it is not part of the overnight completion scope.

## Bottom line

Implemented and reviewable now:

- Goal 3 real audio
- Goal 4 real planning handoff
- Goal 5 real pipeline materialization, reviewer HTML, HyperFrames project bundle, and Remotion MP4
- Goal 6 final reviewer handoff

Not yet real media:

- Goal 2 Seedance clip generation in the accepted bundle
- Therefore the first Goal 5 clip is still a deterministic placeholder, not a live provider MP4
