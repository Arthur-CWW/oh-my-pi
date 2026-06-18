# Slotok Gold Doc

This is the project source-of-truth for continuing Slotok and UGC Studio implementation. Read this before editing Slotok UI, daemon, local state, provider-job, or UGC workflow code.

## Product Thesis

Slotok is a local-first AI video and UGC workbench.

It is not a simple ad generator. It is closer to:

```txt
Cursor/Zed for AI TikTok, UGC, video-understanding, provider jobs, and infinite creative remixing.
```

Slotok owns the creative and media pipeline:

- product and niche briefs
- reference profiles and abstract format mechanics
- synthetic personas and profile bibles
- generated candidates, batches, and review decisions
- branch snapshots, forks, notes, dead ends, and metrics
- provider requests, responses, artifacts, spend caps, and retries
- final layer/timeline editing and export manifests
- developer/provider graph inspection

Symphony Lite or future agent orchestration may operate Slotok, but Slotok is the product/workbench surface and the local creative database.

## Current Maintained Surface

Primary route:

```txt
http://127.0.0.1:47521/ugc-studio/
```

Main app:

```txt
apps/slotok-workbench/
```

The maintained UGC Studio stack is:

- React
- Tailwind
- owned shadcn-style primitives
- owned workbench design-system components
- Electron shell plus local Bun daemon

Do not reintroduce a parallel Solid UGC Studio surface. React/shadcn/Tailwind is the current maintained path.

## Non-Negotiables

### Local-first

Every important creative object must be locally persisted first. Network and provider calls are explicit jobs, not invisible app state.

Current local data root:

```txt
data/ugc-studio/workspaces/<workspace_id>/
```

Current object families:

- workspace
- personas
- campaigns
- branches
- candidates
- notes
- provider jobs
- reference archives
- export manifests
- assets

JSON is the default serialization format. Add another format only with a concrete reason.

### Agent-directed creative search

The main workflow is:

```txt
brief -> generate many directions -> review quickly -> annotate -> fork -> revise -> select winners -> polish/export
```

The user directs one agent to generate, critique, fork, and revise selected sets. Manual editing exists, but the product should not assume users want to hand-edit every attribute up front.

### Whole profile, not one clip

A UGC persona is a TikTok-profile-like collection:

- appearance and genre lane
- voice, accent, energy, speaking style
- interests, niche, mannerisms, posting cadence
- sample clips
- non-CTA posts for persona building
- CTA/conversion posts
- continuity JSON
- branch and candidate history

### Clean-room reference remix

Reference-profile workflows should preserve abstract mechanics and swap identity/product/copy.

Preserve:

- pose and timing mechanics
- gesture rhythm
- shot structure
- edit cadence
- hook/template grammar
- caption layout mechanics
- CTA pattern

Swap:

- recognizable face/body identity
- voice
- exact phrasing
- product/demo slot
- captions/rendered text
- brand marks
- source pixels/audio unless rights-cleared

Use public, user-owned, rights-cleared, or faceless sources first. Do not clone a real creator's recognizable face, voice, private identity, exact captions, copyrighted media, or brand marks without consent.

### Provider spend policy

Provider work must be dry-run-first. Live calls need explicit capped actions and local job records.

Current useful provider direction:

- KIE is the cheap/default UGC generation provider in the app.
- Jimeng/Dreamina reversal is a separate workstream. Consume it through contracts and local job records; do not edit its reversal code from Slotok UI slices unless explicitly assigned.
- Gemini and KIE credits are limited. Be frugal and do not run live generation for routine UI/proof work.

## Design System Direction

Read these before UI work:

- `docs/state/slotok-design-language.md`
- `docs/state/ugc-studio-style-direction.md`
- `docs/state/ugc-studio-design-system.md`

Visual target:

```txt
Native calm workbench
```

Use:

- Codex-like light workbench shell
- Chorus/Conductor-like compact agent workspace feel
- off-white surfaces, pale sidebars, thin borders
- compact typography and 6-10px radii
- sparse blue selection/accent
- dark editor surfaces only where media/layers benefit

Avoid:

- generic SaaS dashboard
- neon/cyberpunk
- card soup
- oversized hero/marketing UI
- making ComfyUI graph the default surface
- making timeline editing the first/default view during exploration

Implementation rule:

- reusable chrome goes into `components/ui/` or `design-system/workbench.tsx`
- `.rugc-*` CSS should shrink toward view-specific media, canvas, timeline, and graph geometry
- do not add fresh reusable `.rugc-*` selectors for buttons, cards, toolbars, panels, badges, metrics, forms, or command surfaces

## Current Implementation Status

Done:

- React UGC Studio route with eight views:
  - Persona Atlas
  - Exploration Board
  - Batch Review
  - Campaign Branch Map
  - Reference Archive
  - Final Layer Editor
  - Developer Graph
  - KIE Proxy
- daemon-backed local workspace loading with fixture fallback
- local JSON store plus write-through SQLite consolidation under `data/ugc-studio/workspaces/<workspace_id>/workspace.sqlite` for workspace, personas, branches, candidates, notes, provider jobs, reference archives, exports, research targets, and template mining jobs
- persona profile-bible edits for niche, voice style, accent, and energy
- branch decision-note editing and dead-end marking
- candidate star/revise/reject actions and note creation
- KIE dry-run/live-capped plan/create UI path
- Codex image/video media-analysis planning with dry-run provider job persistence and explicit live API-key/spend gates
- provider job records saved locally across KIE, Codex, Jimeng, and local providers
- export manifest records from final editor
- workbench design-system foundation and route chrome migration
- visual QA across eight views

Proof files:

- `docs/qa/ugc-local-first-v1.md`
- `docs/qa/slotok-visual-qa.md`

Current proof command set:

```bash
bun run slotok:typecheck
bun run slotok:test
bun run slotok:build
cd apps/slotok-workbench && bun run visual:qa
```

If `visual:qa` is run directly, use:

```bash
cd apps/slotok-workbench && /Users/arthur/.bun/bin/bun scripts/visual-qa.ts
```

## Implementation Sequence

Work in small, proven, committed slices. After each slice:

1. Run the narrow tests for that slice.
2. Run Slotok typecheck/test/build when UI/daemon code changes.
3. Run visual QA for meaningful UI changes.
4. Write or update a proof doc under `docs/qa/`.
5. Commit only the scoped files.

### 1. Reference Archive V1

Goal: make reference-profile remix an actual local-first workflow, not just a placeholder view.

Implement:

- richer reference archive objects for source policy, preserved mechanics, swapped fields, blocked fields, notes, and candidate format outputs
- UI to select a reference profile and edit/archive its mechanics
- local daemon routes for update/delete or patching archive records
- proof that archive specs persist and reload

Do not scrape or download real profiles yet. Use fixture/local abstract mechanics only.

### 2. Workspace Import/Export Bundle

Goal: make a UGC workspace portable and inspectable.

Implement:

- export local workspace bundle manifest as JSON
- include workspace, personas, branches, candidates, notes, provider jobs, reference archives, exports, and asset manifest paths
- import validation path, dry-run first
- proof doc with generated manifest fixture

### 3. Provider Job Queue V1

Goal: turn provider actions into visible local jobs.

Implement:

- provider job list/detail view or inspector section
- job statuses: planned, queued, running, succeeded, failed, blocked
- artifact references and cached request/response preview
- KIE task polling via existing daemon/CLI contracts where available
- no live spend by default

### 4. Batch Review Workflow V1

Goal: make babble-and-prune fast.

Implement:

- selected-set actions across candidates
- keyboard-friendly review controls
- note and verdict history visible per candidate
- filter/sort by status, score, persona, branch
- proof with persisted status/note changes

### 5. Branch/Fork/Rollback V1

Goal: make creative exploration reversible.

Implement:

- create branch snapshot from selected personas/candidates
- fork from branch
- mark branch dead-end
- rollback/select promising branch
- visible decision log in campaign map/inspector

### 6. Final Editor Persistence V1

Goal: make timeline/layer edits real local data.

Implement:

- edit track visibility/lock
- edit clip timing/text/caption payloads
- save export manifests with full timeline JSON
- preview JSON diff in inspector

### 7. Niche/Template Research Queue

Goal: prepare the later research feature without live scraping.

Implement:

- local research target records
- template mining queue records
- clean-room template schema
- status/proof UI

No live scraping until explicitly approved.

### 8. Developer Graph From Real State

Goal: make the graph explain the actual local workspace.

Implement:

- derive graph nodes from personas, candidates, branches, provider jobs, and exports
- show inputs/outputs/artifacts consistently
- expose raw JSON for selected graph node

## File Ownership Guide

Safe Slotok owner paths:

```txt
apps/slotok-workbench/src/renderer/ReactUgcStudio.tsx
apps/slotok-workbench/src/renderer/ugcStudioModel.ts
apps/slotok-workbench/src/renderer/design-system/**
apps/slotok-workbench/src/renderer/components/ui/**
apps/slotok-workbench/src/renderer/styles.css
apps/slotok-workbench/src/daemon/ugc-*.ts
apps/slotok-workbench/src/ugc/**
apps/slotok-workbench/scripts/visual-qa.ts
docs/plans/slotok-gold-doc.md
docs/plans/ugc-studio-workstreams.md
docs/state/slotok-design-language.md
docs/state/ugc-studio-*.md
docs/qa/ugc-*.md
docs/qa/slotok-visual-qa.md
```

Coordinate before touching:

```txt
packages/jimeng-client/**
packages/browser-use/**
packages/web-access/**
apps/slotok-workbench/src/daemon/eval-store.ts
apps/slotok-workbench/src/types.ts
package.json
AGENTS.md
```

Those files are often active in other concurrent workstreams.

## Commit Discipline

Use one commit per proven feature slice.

Commit message shape:

```txt
Add UGC reference archive editor
Persist UGC workspace bundles
Add provider job queue UI
```

Do not stage unrelated dirty files. The repo often has parallel Codex sessions editing Jimeng, browser, Cua, or shared docs.

## Completion Definition

This goal is complete when the V1 UGC Studio can:

1. open a local workspace
2. create/edit persona profile bibles
3. archive abstract reference mechanics
4. generate or dry-run provider jobs with local request/response records
5. review candidate batches with persistent verdicts and notes
6. fork/rollback creative branches
7. persist final timeline/export manifests
8. inspect the local developer graph
9. export/import workspace bundles
10. pass typecheck, tests, build, and visual QA with proof docs
