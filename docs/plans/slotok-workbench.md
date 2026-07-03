# Slotok Workbench Plan

Slotok is the AI TikTok/video/UGC remix workbench/product. It is separate from Symphony Lite/SymphonyX, which is the meta-agent orchestration harness that can help build and operate Slotok.

Working tagline:

```txt
Cursor/Zed for AI TikTok/video pipeline engineering and infinite remixes.
```

Design-language note: read `docs/state/slotok-design-language.md` before changing the UI. The current primary visual north star is the Codex light workbench screenshot in `docs/design/slotok/references/codex-light-workbench-sidebar.png`: clean native light shell, soft sidebar, document-like center, restrained cards/inspector panels. Do not continue the dark/orange analytics-dashboard aesthetic.

## Current status

As of 2026-06-08, the `pipeline_workbench_architecture` workflow completed as an in-memory design fan-out:

- orchestration design
- Solid/Electron stack review
- DAG renderer review
- Swift/native app review
- final synthesis

Those workflow subagents were not persistent sessions. Their conclusions are distilled here as the Slotok implementation backlog.

A tiny, paused scaffold exists at:

```txt
apps/slotok-workbench/
```

It currently only contains package/tsconfig/types. Treat it as disposable unless renamed into the workbench app.

## Product boundary

Slotok owns:

- video references and archives
- video-understanding decompositions
- generated assets and variants
- provider/model evals
- pipeline DAGs and versions
- media artifacts, previews, metrics, annotations
- rerun/resume controls for generation/eval pipeline stages
- custom/generated data viewers
- local-first review UX for infinite remix loops

Symphony Lite/SymphonyX owns:

- orchestrating Pi/Codex-like subagents
- durable workflow/subagent records
- forked/persistent child sessions
- reviewer personas
- tool profiles
- tmux/Zellij/process monitoring
- workflow DAGs of agent work

Slotok may use Symphony Lite internally, but they should not be collapsed.

Coordination note: another Pi agent in tmux pane `%5` edited shared Symphony/Slotok docs during planning. Check `docs/coordination/agent-edit-log.md` for the latest cross-agent notes. Arthur kept the durable-workflow/subagent-start requirement, but rejected the heavier agent-message/inbox/event-log communication design.

## Recommended v1 architecture

```txt
Electron shell
  ├─ SolidJS renderer
  ├─ narrow preload/IPC bridge
  └─ supervises local Bun daemon

Bun daemon
  ├─ SQLite/source-of-truth state
  ├─ pipeline/job runner
  ├─ provider adapters
  ├─ ffmpeg/media helpers
  ├─ file/artifact APIs
  └─ optional SymphonyX/agent orchestration bridge
```

Use Electron for IDE-like local permissions: processes, terminals, filesystem, file watching, native menus, clipboard, and eventually CDP/browser automation.

Use SolidJS for dense local-first UI, fast reactive inspectors, vim-like shortcuts, and controllable custom components.

Use Effect v4 in backend/domain/adapters, not in every UI component.

## Core data model

Every pipeline object should be inspectable as an element:

```ts
interface PipelineElement {
  id: string
  kind: string
  stage: string
  version: string
  status: string
  inputs: string[]
  outputs: string[]
  artifacts: string[]
  metrics: Record<string, unknown>
  annotations: string[]
  createdAt: string
}
```

Important first-class objects:

- run
- stage attempt
- provider request
- video reference
- decomposition
- asset
- artifact
- annotation
- custom view
- version/diff

## Views

Vim-like view switching should use `g<letter>` where possible.

Planned views:

| Shortcut | View | Purpose |
|---|---|---|
| `gr` | Runs | pipeline/eval run list |
| `gd` | DAG | stage/artifact/provider graph |
| `ge` | Element | selected element detail |
| `gj` | JSON | raw JSON / schema view |
| `gm` | Metrics | cost/latency/tokens/provider matrix |
| `ga` | Artifacts | frames/videos/images/audio/files |
| `gn` | Notes | annotations and markup |
| `gl` | Logs | process/provider/job logs |
| `gt` | Terminal | local terminals / agent sessions |
| `gv` | Views | generated/custom view registry |

Basic navigation:

- `j/k` next/previous element
- `h/l` parent/child or previous/next pane depending context
- `gg/G` first/last
- `/` search/filter
- `?` shortcuts
- `Enter` open/focus
- `Esc` close modal / return focus
- `Space` toggle selection/mark
- `a` annotate
- `r` rerun selected stage/element
- `R` rerun descendants / branch variant
- `d` diff versions
- `y` copy path/id/JSON pointer
- `o` open artifact externally

## DAG renderer direction

Build custom first:

```txt
elkjs layout worker + Solid node cards + SVG edges
```

MVP DAG should be read/review-first:

- pan/zoom/fit
- keyboard navigation across nodes
- selected node inspector
- status/cost/latency badges
- thumbnails on artifact nodes
- collapsed subgraphs later
- explicit rerun/branch actions rather than freeform graph editing at first

Avoid React Flow unless we switch the whole app to React. Avoid Cytoscape unless graph analytics becomes the primary need.

## Custom/generated views

Raw JSON must always be available, but each element kind should support richer view modules.

View module concept:

```txt
selected element + artifacts + metrics -> renderer
```

Renderer types:

- built-in Solid component
- generated HTML/JS iframe
- generated TSX/Solid component in a hot-reload sandbox
- raw JSON fallback

`pi-generative-ui` is inspiration for quickly generating rich HTML widgets, but Slotok views should be persistent, data-bound, hot-swappable, and versioned.

## Data loading / performance

Local-first UX requirements:

- preload batches of summaries into browser memory
- lazy-load large JSON/media/logs/details
- virtualize tables/lists
- keep raw artifacts content-addressed on disk
- precompute thumbnails/frame strips/waveform metadata
- cache parsed provider outputs
- stream job/event updates over SSE/WebSocket or Electron IPC
- avoid putting giant raw JSON blobs directly into reactive state

## API / type safety

Prefer strict TypeScript and schema-decoded boundaries.

Possible boundary stack:

- Effect Schema for core schemas and external data decoding
- small typed JSON-RPC/HTTP contract between renderer and Bun daemon
- versioned SQLite migrations
- adapters around third-party libraries so they can be swapped/vendored later

## Initial implementation backlog

### 1. Rename/reset scaffold

Decide whether to rename:

```txt
apps/slotok-workbench scaffold
```

or keep `pipeline-viewer` as a temporary eval viewer. Recommended: rename to `slotok-workbench` before more code lands.

### 2. Bun daemon MVP

Create a local daemon package/app that can:

- read current video-understanding eval SQLite
- list runs/results/elements
- serve artifact files safely by ID/path
- persist annotations
- expose rerun action endpoints in dry-run mode first

### 3. Solid/Electron shell MVP

Build:

- app frame with command palette
- keyboard router
- run list
- element list
- detail pane
- raw JSON pane
- notes pane

### 4. Current eval adapter

Adapt existing data:

```txt
data/provider-evals/video-understanding/evals.sqlite
```

into Slotok elements:

- eval run
- provider result
- parsed decomposition
- sampled frames
- provider raw response
- metrics row

### 5. DAG MVP

Render a minimal graph:

```txt
reference video -> sampled frames -> provider request -> parsed decomposition -> asset plan/provider matrix
```

### 6. Annotation/markup MVP

Annotations should support:

- note
- tags
- status
- rating
- target kind/id/JSON pointer
- created/updated timestamps

### 7. Rerun/resume MVP

Start with dry-run commands:

- rerun selected provider result
- rerun with different max frames/output tokens
- branch prompt/provider settings

Then connect to real provider calls with explicit confirmation/spend caps.

### T-2026-06-10-064 design-system migration note

2026-06-24 slice: migrated the repeated native `label` + `select` form-control pattern in the review queue, final-editor candidate picker, reference archive controls, and KIE route controls to owned workbench primitives (`WorkbenchField`, `WorkbenchSelect`). The KIE route card copy now names local dry-run JSON as the default action and reserves live wording for the capped provider request button.

Root verification command for this slice:

```sh
bun --cwd apps/slotok-workbench vitest run src/renderer/ReactUgcStudio.test.ts src/renderer/design-system/workbench.test.tsx
```

### 8. CDP/UI iteration harness

Use CDP/Playwright to:

- open app in background
- capture screenshot
- check console errors
- test shortcuts
- verify navigation/selection/annotation flows

No foreground browser stealing.

## Open decisions

- Electron main process plus Bun daemon supervision details.
- Whether to use SQLite directly from Bun daemon only, or also expose read-only DB snapshots to renderer.
- Exact typed RPC library: Effect RPC/custom JSON-RPC/tRPC-like.
- Whether generated views are iframe-only initially or can be first-class hot-reloaded Solid modules.
- Slotok app name vs subtitle: `Slotok`, `Slotok Workbench`, `Infinite Remix Machine`, or another name.

## Next concrete step

Do not keep extending the old `apps/pipeline-viewer` name blindly; it has been renamed to `apps/slotok-workbench`. First choose one path:

1. Rename it to `apps/slotok-workbench` and implement the eval-data viewer MVP.
2. Delete it and start a clean Electron/Solid/Bun daemon scaffold.
3. Keep it as a thin browser-only eval viewer while Slotok starts separately.

Recommended: option 1 if moving quickly, option 2 if we want cleaner Electron/Solid boundaries from the start.
