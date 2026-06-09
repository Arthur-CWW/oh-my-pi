# UGC Studio Workstreams

UGC Studio is the creative workspace for AI UGC persona/profile exploration, reference-format remixing, campaign branching, and final clip editing.

Read first:

- `docs/state/video-creative-direction.md`
- `docs/state/ugc-studio-style-direction.md`
- `docs/design/ugc-studio/README.md`

## Product Model

The core object is not a single ad. It is a creative search graph:

```txt
product / niche / offer
→ reference profiles and formats
→ synthetic personas / profile bibles
→ candidate batches
→ notes / critiques / forks / snapshots
→ CTA and non-CTA campaign tracks
→ final layer/timeline edits
→ export / metrics / rerun
```

The user mostly directs one agent to generate, critique, fork, and revise selected sets. Manual controls are important, but mainly for late-stage tuning.

## Workstreams

| ID | Workstream | Purpose | First implementation target |
|---|---|---|---|
| `ui-workspace` | Multi-view workspace shell | Replace the single canvas/timeline route with view modes that match the saved design refs. | React/shadcn/Tailwind route with Persona Atlas, Exploration Board, Batch Review, Campaign Map, Final Editor, Developer Graph, and persistent command bar. |
| `persona-profile` | Synthetic influencer/profile model | Treat personas as TikTok-profile-like collections, not single faces. | Typed fixture/model for appearance, voice, accent, niche, interests, sample clips, notes, continuity JSON, and posting strategy. |
| `batch-review` | Babble-and-prune loop | Fast candidate review with play/reject/star/fork/annotate and selected-set agent commands. | Candidate grid/player/table and note/score inspector. |
| `branch-history` | Snapshot/fork system | Make creative exploration reversible and comparable. | Branch map fixture/model with checkpoints, parent/child links, decision notes, metrics deltas, rollback/fork actions. |
| `reference-profile-remix` | Profile/style decomposition | Archive/decompose a public or rights-cleared profile into reusable mechanics. | Planning/model only at first: preserved-vs-swapped schema and reference profile view. |
| `format-mining` | Niche/template research | Research a niche, find winning profiles/campaigns/templates, and turn them into abstract reusable formats. | Back-burner research queue and schema hooks; no live scraping until approved. |
| `final-editor` | Layer/timeline polish | Edit selected final clips: layers, captions, voice, b-roll, product demo, CTA, export. | Keep `docs/design/ugc-studio/recovered/generated-01.png` as the target reference. |
| `developer-graph` | Pipeline/debug graph | Inspect provider nodes, graph JSON, model routes, costs, and generated artifacts. | Keep `docs/design/ugc-studio/recovered/generated-06.png` as the target reference. |

## Stack Decision

React + Tailwind + shadcn-style primitives are the maintained UI stack. The old Solid UGC Studio implementation has been retired so the product does not carry two competing workspace surfaces. Keep the current React visual direction intact while adding real data, persistence, and actions.

## Local-First Architecture

UGC Studio should behave like a local Electron creative database first, with provider APIs as explicit jobs rather than hidden app state.

Recommended local state shape:

```txt
data/ugc-studio/
  workspaces/<workspace_id>/
    workspace.json
    personas/<persona_id>.json
    campaigns/<campaign_id>.json
    branches/<branch_id>.json
    candidates/<candidate_id>.json
    notes/<note_id>.json
    provider-jobs/<job_id>.json
    assets/
      source/
      generated/
      exports/
```

Local-first rules:

- Persist every workspace object as versioned JSON first; add SQLite indexes only for search, filtering, and task queues.
- Store provider requests/responses, spend caps, model routes, and artifacts as local job records.
- Keep generated media and reference archives local; never require cloud sync to open a project.
- Make import/export explicit: workspace bundle, persona bible, campaign branch, candidate batch, or final export.
- Treat live provider calls as queue jobs with dry-run previews, cached payloads, retries, and cost metadata.

## Parallel Implementation Tasks

These lanes are intended to be forked into separate agent sessions. Each lane should avoid editing another lane's owner paths without a coordinator handoff.

| Lane | Goal | Primary files | Output paths |
|---|---|---|---|
| `local-store` | Add the local-first workspace repository: JSON object store, optional SQLite index, schema validation, import/export bundle. | `apps/slotok-workbench/src/daemon/**`, `apps/slotok-workbench/src/types.ts`, future `apps/slotok-workbench/src/local-store/**` | `data/ugc-studio/**`, `docs/qa/ugc-studio-local-store.md` |
| `react-data-binding` | Replace static React fixtures with daemon-backed workspace loading/saving while preserving the current UI layout. | `apps/slotok-workbench/src/renderer/ReactUgcStudio.tsx`, `apps/slotok-workbench/src/renderer/ugcStudioModel.ts`, renderer tests | `docs/qa/ugc-studio-react-data-binding.md` |
| `persona-profile` | Implement editable persona/profile bibles: appearance, voice, accent, niche, interests, posting strategy, continuity JSON, samples. | React persona components, local schemas, daemon CRUD endpoints | `data/ugc-studio/**/personas/**`, `docs/qa/ugc-studio-personas.md` |
| `branch-notes` | Make branches, snapshots, comments, and fork/dead-end decisions persistent and navigable. | campaign map UI, local-store schemas, note endpoints | `data/ugc-studio/**/branches/**`, `data/ugc-studio/**/notes/**` |
| `provider-jobs` | Turn KIE/Jimeng calls into explicit local queue jobs with dry-run payloads, caps, status polling, artifacts, and cached results. | `packages/ugc-cli/**`, `apps/slotok-workbench/src/daemon/**`, provider UI | `data/ugc-studio/**/provider-jobs/**`, `docs/qa/ugc-studio-provider-jobs.md` |
| `reference-archive` | Add reference-profile archive/decomposition models for public or rights-cleared/faceless profiles, preserving abstract mechanics. | future archive UI/schema, `packages/twitter-archive/**` only after handoff | `data/ugc-studio/**/reference-archives/**`, `docs/qa/ugc-studio-reference-archive.md` |
| `final-export` | Persist final layer/timeline edits and export manifests for captions, voice, b-roll, product demo, CTA, and rendered files. | final editor UI, local schemas, export daemon endpoints | `data/ugc-studio/**/exports/**`, `docs/qa/ugc-studio-final-export.md` |

## Reference Profile Remix

This is a later feature, but it should shape the data model now.

Goal:

```txt
profile archive
→ extract pose/timing/gesture/shot rhythm
→ extract hook/voice-line/caption-template grammar
→ create a format/profile bible
→ swap synthetic persona, product, voice, hook copy, captions, CTA
→ generate candidates and compare against abstract mechanics
```

Preserve:

- pose/timing and gesture rhythm
- shot structure and edit cadence
- hook family and template grammar
- caption/text layout mechanics
- CTA pattern and posting strategy

Swap:

- recognizable face/body identity
- voice and exact phrasing
- product/demo/proof slot
- captions and rendered text
- brand marks and source media

Clean-room boundary:

- Use public, user-owned, or rights-cleared media only.
- Store abstract mechanics, not source pixels/audio/transcripts unless rights allow it.
- Do not clone a real creator's recognizable face, voice, private identity, exact captions, copyrighted media, or brand marks without consent.
- Faceless profiles are lower risk and should be prioritized for early tests because their value is mostly timing, templates, b-roll, captions, hooks, and posting strategy.

## Design References

Use these as implementation references:

- `docs/design/ugc-studio/workspace-views/01-persona-atlas.png`
- `docs/design/ugc-studio/workspace-views/02-exploration-board.png`
- `docs/design/ugc-studio/workspace-views/03-batch-review-player.png`
- `docs/design/ugc-studio/workspace-views/04-campaign-branch-map.png`
- `docs/design/ugc-studio/recovered/generated-01.png`
- `docs/design/ugc-studio/recovered/generated-06.png`
- `docs/design/ugc-studio/references/chorus-screenshot.png`
- `docs/design/ugc-studio/references/abg-cmo-korean-beauty-flow-reference.png`

## V1 UI Notes

- Left sidebar should be prettier and split into clearer sections: workspace navigation plus campaign/profile/library groups.
- Right inspector should support dual creative/JSON views instead of making JSON the only inspector surface.
- The main route should default to Persona Atlas or Exploration Board, not the final timeline editor.
- Floating command bar persists across views and applies to selected personas, candidates, branches, or snapshots.
- Secondary settings should be lightweight inspectors, popovers, or modals.
