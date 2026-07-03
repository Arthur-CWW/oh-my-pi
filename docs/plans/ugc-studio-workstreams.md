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
| `reference-profile-remix` | Profile/style decomposition | Archive/decompose selected profiles or formats into reusable mechanics. | Planning/model only at first: preserved-vs-swapped schema, source/use notes, and reference profile view. |
| `format-mining` | Niche/template research | Research a niche from local/manual or approved archived inputs, normalize reusable mechanics, and hand them to Slotok/artifact-library records. | JSON-first `research-targets` + `template-mining-jobs` routed through the current daemon store, synced SQLite rows, artifact-library format outputs, and first route proof; no live scraping until approved. |
| `final-editor` | Layer/timeline polish | Edit selected final clips: layers, captions, voice, b-roll, product demo, CTA, export. | Keep `docs/design/ugc-studio/recovered/generated-01.png` as the target reference. |
| `developer-graph` | Pipeline/debug graph | Inspect provider nodes, graph JSON, model routes, costs, and generated artifacts. | Keep `docs/design/ugc-studio/recovered/generated-06.png` as the target reference. |

## Stack Decision

React + Tailwind + shadcn-style primitives are the maintained UI stack. The old Solid UGC Studio implementation has been retired so the product does not carry two competing workspace surfaces. Keep the current React visual direction intact while adding real data, persistence, and actions.

## React UI Test Invariants

When a React UGC Studio component is added or materially changed, cover the changed surface with a focused snapshot only if it protects a stable contract. Prefer view-model arrays, design-system class-token contracts, and semantic copy/status invariants over full rendered markup snapshots. Broad HTML snapshots are noisy and should be replaced with narrower invariants that explain the component behavior they guard.

Current T-2026-06-09-008 coverage: `ReactUgcStudio.test.ts` asserts the real provider surface copy and migrated `WorkbenchField` / `WorkbenchSelect` / `WorkbenchNote` primitive class-token contract, while `design-system/workbench.test.tsx` snapshots the provider shell, content layout, and command surface as class-token/copy view models rather than broad markup.

## Local-First Architecture

UGC Studio should behave like a local Electron creative database first, with provider APIs as explicit jobs rather than hidden app state.

Canonical local state shape:

```txt
data/ugc-studio/
  workspaces/<workspace_id>/
    state.json                         # current daemon write path until SQLite becomes canonical
    workspace.sqlite                  # synced object ledger; target canonical store
    bundles/                          # import/export/backup JSON
    assets/
      source/                         # local inputs with source/use notes
      generated/
      exports/
```

Local-first rules:

- Current daemon writes JSON state/shards first and syncs `workspace.sqlite`; the target is to migrate object persistence to SQLite-first while keeping JSON for bundle import/export, backups, compatibility fixtures, and inspectable proof artifacts.
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
| `reference-archive` | Add reference-profile archive/decomposition models for selected profiles and faceless formats, preserving abstract mechanics plus source/use metadata. | future archive UI/schema, `packages/twitter-archive/**` only after handoff | `data/ugc-studio/**/reference-archives/**`, `docs/qa/ugc-studio-reference-archive.md` |
| `final-export` | Persist final layer/timeline edits and export manifests for captions, voice, b-roll, product demo, CTA, and rendered files. | final editor UI, local schemas, export daemon endpoints | `data/ugc-studio/**/exports/**`, `docs/qa/ugc-studio-final-export.md` |

## Reference Profile Remix

This is a later feature, but it should shape the data model now.

Goal:

```txt
profile archive
→ select archived `ArchiveUser`/`ArchiveTweet`/`ArchiveMedia` samples
→ extract pose/timing/gesture/shot rhythm
→ extract hook/voice-line/caption-template grammar
→ export `ReferenceProfileArchiveExport` mechanics/evidence
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

Reference handling:
- Use `ReferenceProfileArchiveExport` from `packages/twitter-archive/src/index.ts` as the handoff shape when the source is Twitter/X: profile identity stays an `ArchiveUser`, samples stay archived tweet/media ids, and mechanics evidence points back to stored tweet/media/source rows instead of inventing a second profile archive schema.

- Keep source/use metadata that helps search, iteration, comparison, reruns, and handoff: source URL/path, capture date, profile/format notes, chosen samples, abstract mechanics, intended output lane, and distribution constraints.
- Store raw source pixels/audio/transcripts only when the workflow needs them and the local archive/export rules for that lane allow it; otherwise store derived mechanics, thumbnails, notes, and artifact refs.
- Do not turn real faces, voices, exact captions, source media, or brand marks into direct generation inputs unless the manifest/export explicitly allows that lane. For public/commercial release, record release-specific source/media reuse constraints on the export/campaign rather than making local remix exploration depend on public-release rules.
- Faceless profiles are useful early tests because their value is mostly timing, templates, b-roll, captions, hooks, and posting strategy.
- Next local proof: build one reference-archive JSON fixture from an existing local Twitter archive SQLite/dev-API state without live capture, verify every mechanic evidence `tweetId`/`mediaId` resolves to stored archive rows, and save it under `data/ugc-studio/<workspace>/reference-archives/` with the source lane, source URL, capture time, preserve/swap/source-use notes, and distribution constraints.

## Niche / Template Mining Plan (`T-2026-06-09-022`)

Purpose: turn a niche brief into reusable format templates that can feed the artifact library, candidate generation, and Slotok's developer graph without live scraping.

Inputs:

- Local niche brief: product, audience, offer, banned claims, desired persona lane, and proof assets.
- Local source notes: selected clips/exports, public docs/product pages already archived by an approved lane, or manual analyst notes. No TikTok/X/CapCut/Arcads scraping in this step.
- Existing Slotok objects: `referenceArchives`, `referenceAssets`, candidates, notes, and provider-job dry-run plans.
- Optional later inputs only after approval: passive browser captures or source manifests with explicit source/use labels.

Normalized template record:

```json
{
  "researchTarget": {
    "schemaVersion": "ugc-studio.research-target.v1",
    "platform": "internal",
    "niche": "faceless skincare proof UGC",
    "query": "manual local notes: hook, scene rhythm, proof slot, caption CTA",
    "sourceUse": "structure-notes"
  },
  "templateSpec": {
    "schemaVersion": "ugc-studio.clean-room-template.v1",
    "id": "template_faceless_skincare_proof_v0",
    "title": "Faceless skincare proof loop",
    "category": "format",
    "preservedMechanics": {
      "hookFamily": "quiet problem recognition",
      "sceneBeats": ["problem close-up", "routine insert", "proof texture", "soft CTA"],
      "editCadence": "2-3 second cuts",
      "captionLayout": "two safe-area caption blocks plus proof line",
      "assetSlots": ["synthetic hand/demo", "product packshot", "bathroom counter", "before-after claim card"],
      "ctaPattern": "low-pressure save or try prompt"
    },
    "swapSlots": ["persona", "product", "hook copy", "proof asset", "CTA copy", "voice", "caption style"],
    "blockedFields": ["face/body identity", "voice", "exact captions", "source pixels/audio", "brand marks"],
    "sourceUse": "structure-notes",
    "proofNotes": ["Manual/offline abstraction only; no live scraping or provider spend."]
  }
}
```

Storage and handoff:

- Persist the queue item through the current JSON-first daemon store so `state.json` / workspace shards remain authoritative during this phase, then sync `research-targets` and `template-mining-jobs` rows into `data/ugc-studio/workspaces/<workspace_id>/workspace.sqlite`.
- Keep JSON bundle export/import as a compatibility and review surface; promote SQLite to canonical only in the later store-migration slice.
- Promote reusable outputs into the artifact library as `referenceArchives[].candidateFormatOutputs` with `kind: "format-template" | "caption-template" | "hook-family" | "cta-pattern"` and `manifestJson` containing the abstract mechanics.
- Link candidate generations through `templateMiningJobs[].candidateIds` only after a local dry-run or explicit capped provider job creates candidates.
- Slotok's Developer Graph should show edges `research target -> template job -> candidate/export`; absent source media should not block local graph proof when the mechanics and source/use notes are present.

First local proof:

```bash
cd apps/slotok-workbench && /Users/arthur/.bun/bin/bun test src/daemon/ugc-sqlite-store.bun.test.ts -t "keeps per-collection SQLite rows in sync after JSON store mutations"
```

Proof path: `apps/slotok-workbench/src/daemon/ugc-sqlite-store.bun.test.ts`; the SQLite assertion covers `objects.collection IN ('research-targets', 'template-mining-jobs')`. For daemon-backed manual proof, inspect `data/ugc-studio/workspaces/<workspace_id>/workspace.sqlite`.

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
