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

## Commit boundaries

Commit after green verification for each coherent slice:

1. Core local-first V1 workflows.
2. Public inspiration asset capture/manifests.
3. Codex/KIE execution pipeline.
4. Final visual QA/proof pass.

## Verification gates

```bash
bun run slotok:typecheck
bun run slotok:test
bun run slotok:build
bun run lint:unsafe-types
cd apps/slotok-workbench && bun run visual:qa
```
