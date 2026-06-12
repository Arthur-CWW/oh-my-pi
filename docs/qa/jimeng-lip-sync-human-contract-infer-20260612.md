# Jimeng Lip-Sync Human Contract Inference

Date: 2026-06-12

## Scope

Packet: `lip-sync-human`

This pass improved `jimeng-browser-proxy contract-infer` for existing lip-sync/digital-human dry-run proof bundles. It does not claim live lip-sync generation. Live submit still needs passive UI capture compare and explicit approval because the submit/pre-process paths create provider task state and may spend credits.

## Source Proof Bundles

- `data/jimeng-lab/proof-20260610-lip-sync-image-plan/`
- `data/jimeng-lab/proof-20260610-lip-sync-vod-plan/`
- `data/jimeng-lab/proof-20260612-video-preprocess-plan/`
- `data/jimeng-lab/proof-20260612-video-preprocess-query-plan/`

Generated contract-infer output:

- `data/jimeng-lab/proof-20260612-lip-sync-human-contract-infer/lip-sync-image/normalized/contract/contract-summary.md`
- `data/jimeng-lab/proof-20260612-lip-sync-human-contract-infer/lip-sync-video/normalized/contract/contract-summary.md`
- `data/jimeng-lab/proof-20260612-lip-sync-human-contract-infer/preprocess/normalized/contract/contract-summary.md`
- `data/jimeng-lab/proof-20260612-lip-sync-human-contract-infer/preprocess-query/normalized/contract/contract-summary.md`

## What Changed

- `contract-infer` now detects `plan.endpoint`, which is the shape used by the lip-sync dry-run submit plans.
- CLI flag inference now recognizes useful lip-sync/digital-human fields:
  - `--text`
  - `--speed`
  - `--mode`
  - `--videoVid`
  - `--videoUri`
  - camelCase `toneId` as `--voice-id`
- Added a compact lip-sync fixture bundle for:
  - image/avatar lip-sync submit plan
  - VOD lip-sync submit plan
  - pre-process submit
  - pre-process result query
- Added Bun assertions and Vitest snapshot coverage for the generated scaffold.

## Verification

```bash
mise exec -- bun test ./test/contract-infer.test.ts
mise exec -- bunx vitest run test-vitest/contract-infer.snapshot.test.ts -u
```

Both commands passed. `mise` printed a sandbox cache-write warning for `~/.cache/mise`, but the tests completed successfully.

## Next Probe

Capture a real Jimeng lip-sync UI submit and compare it against the generated image/VOD lip-sync plans before enabling live submit. If approved, run one image/avatar talking-head example at concurrency 1, record before/after credits, save raw/normalized JSON plus playable media, then promote the observed response into the typed client surface.
