# Slotok Workstream Ledger

## Orchestrator contract

Arthur wants this run as an ongoing orchestrated workstream: decompose work, dispatch subagents in parallel where safe, verify once per phase, and commit focused feature slices. Do not stop at phase boundaries.

## Product lanes

Slotok has two first-class lanes:

- `brainrot` — Pleometric-style surreal/postmodern meme-video creation and decomposition.
- `ugc-ads` — UGC Studio for making ads: personas, hooks, product demos, proof slots, CTAs, review/fork/export.

These lanes should exist in data/model facets, reference tags, filters, prompts, provider defaults, and UI copy. Do not hardcode them only as labels.

## Running dev surface

Renderer:

```txt
http://127.0.0.1:47521/ugc-studio/
```

Daemon:

```txt
http://127.0.0.1:47522
GET /api/ugc/workspace
```

Runtime files:

```txt
artifacts/slotok-dev/renderer.pid
artifacts/slotok-dev/daemon.pid
artifacts/slotok-dev/renderer.log
artifacts/slotok-dev/daemon.log
```

Stop/restart by killing the PIDs above, then restarting `bun run dev:daemon` and `bun run dev:renderer` from `apps/slotok-workbench/`.

Provider/media proof routes:

```txt
POST /api/ugc/codex/plan
POST /api/ugc/codex/jobs
POST /api/ugc/codex/candidates/<candidate_id>/analyze-video
POST /api/ugc/kie/analysis-to-kie        parent verifies when backend route lands; otherwise use KIE dry-run plan with Codex context
POST /api/ugc/reference-catalog/plan     parent verifies pending manifestPaths extension; current fallback is roots + direct manifest inspection
POST /api/ugc/reference-catalog/import   parent verifies pending manifestPaths extension; apply only after dry-run preview exists
```

## Current parallel agents

- `CoreBackendData` — reference catalog import + bundle/backend tests.
- `CoreWorkflowUI` — completed React V1 workflow UI slice; parent must verify.
- `CoreDocsProof` — completed proof/goal ledger update; parent must verify.
- `HiggsfieldAssetScout` — public Higgsfield/Supercomputer inspiration assets under `data/ugc-studio/reference-assets/higgsfield/`.
- `ArcadsAssetScout` — public Arcads inspiration assets under `data/ugc-studio/reference-assets/arcads/`.

## Reference roots

Local TikTok catalog roots:

```txt
data/tiktok-catalogue/pleometric      61 mp4 / 61 info.json / 61 jpg
data/tiktok-catalogue/mynameissico   281 mp4 / 281 info.json / 281 jpg
data/tiktok-catalogue/staceypilled   153 mp4 / 153 info.json / 153 jpg
```

Public vendor inspiration assets are reference/inspiration only unless a manifest explicitly marks reuse allowed. Store provenance and rights notes.

Public reference asset manifests for current proof:

```txt
data/ugc-studio/reference-assets/higgsfield/manifest.json
data/ugc-studio/reference-assets/arcads/manifest.json
```

Those manifests are local reference/inspiration inputs only. Preserve provenance and rights notes; do not feed Higgsfield/Arcads public assets into generation unless a manifest explicitly marks reuse allowed.

## Pi/OMP workflow telemetry lane

Arthur may run creative execution as Pi/OMP dynamic workflows instead of forcing every creative step through the Slotok daemon. Treat this as "just another workflow" backed by `packages/dynamic-workflows` (`parseWorkflowScript` / `runWorkflow`) and documented in `workflows/slotok-creative-agents/README.md`.

Decision: Slotok owns the browser telemetry contract. Add append-only workflow/event state in Slotok, then adapt Pi/OMP/dynamic-workflows into it.

- Primary live path: `packages/dynamic-workflows` callbacks (`onLog`, `onPhase`, `onAgentStart`, `onAgentEnd`) append `workflowEvents` and update `workflowRuns`.
- Browser path: Slotok daemon exposes `GET /api/ugc/workflows`, `GET /api/ugc/workflows/:runId/events?after=<eventId>`, and `GET /api/ugc/workflows/events/stream` as SSE. UI subscribes by SSE and falls back to polling.
- Historical adapter: OMP `omp stats` / `omp-stats` server is usage-history only (`/api/stats`, `/api/sync`), so use it later as a secondary adapter, not the live source of truth.
- Process adapter: OMP `--mode rpc` can stream live `AgentSessionEvent`/subagent frames over stdio when Slotok owns the child process. Wrap that behind the Slotok daemon; never expose stdio directly to the browser.
- Artifact adapter: Pi/OMP session JSONL, output artifacts, plans, and resource files can be polled/tail-imported later into the same event table.

Store this as event sourcing, not only current snapshots. Current agent status is derived from latest events, while raw event history remains inspectable for proof/replay.

Slotok remains the local-first state viewer/reviewer. Pi/OMP personas perform creative operations and import structured JSON-safe results through daemon routes.

## Commit boundaries

Commit after green verification for each coherent slice:

1. Core local-first V1 workflows.
2. Public inspiration asset capture/manifests.
3. Codex/KIE execution pipeline.
4. Final visual QA/proof pass.

Current proof docs:

```txt
docs/qa/slotok-provider-pipeline.md
docs/research/slotok-reference-assets.md
docs/qa/slotok-analysis-results-ui.md
docs/qa/ugc-local-first-v1.md
```

## Verification gates

```bash
bun run slotok:typecheck
bun run slotok:test
bun run slotok:build
bun run lint:unsafe-types
cd apps/slotok-workbench && bun run visual:qa
```

## Manual visual QA checklist

Parent should use the exact checklist in `docs/qa/slotok-provider-pipeline.md` for the provider/media pass:

1. Open `http://127.0.0.1:47521/ugc-studio/` and confirm daemon `http://127.0.0.1:47522`.
2. Use `artifacts/slotok-dev/renderer.pid`, `daemon.pid`, `renderer.log`, and `daemon.log` only for dev-server status/errors.
3. Confirm Codex analysis creates dry-run local provider jobs with frame/artifact metadata and survives reload.
4. Confirm live Codex remains explicit and capped: route validation requires `live: true` plus `maxSpendUsd`, then delegates auth to the runtime resolver/runner. The resolver supports API-key mode (`apiKey`, `CODEX_API_KEY`, `OPENAI_API_KEY`) and Codex ChatGPT OAuth session mode (`~/.codex/auth.json`, override `CODEX_AUTH_FILE`) as separate paths; do not treat OAuth access tokens as OpenAI API keys. Mark multimodal live OAuth analysis blocked/unsupported until parent validates a real Codex/ChatGPT backend endpoint.
5. Confirm analysis-to-KIE is dry-run planning only, using the backend route when present or existing KIE plan/create surfaces with Codex context while the route is pending.
6. Confirm Higgsfield/Arcads `manifestPaths` plan/import keeps assets reference-only with provenance and rights notes once that extension lands; while pending, inspect manifests directly and verify existing `roots` planning does not live-scrape or promote public assets into provider inputs.
7. Confirm no live provider success is claimed unless parent explicitly runs a live/capped action and records that proof separately.
