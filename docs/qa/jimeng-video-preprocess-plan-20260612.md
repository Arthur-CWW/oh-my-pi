# Jimeng Video Preprocess Plan Proof

Date: 2026-06-12

Scope: dry-run request builders for lip-sync/digital-human preprocessing endpoints:

- `/mweb/v1/video_generate/pre_process`
- `/mweb/v1/video_generate/mget_pre_process_result`

These endpoints are part of the L1 lip-sync/digital-human workflow. They are useful before live avatar or lip-sync generation because the frontend runs pre-check tasks for image/avatar creation, voice recommendation, audio detection, and audio silence checks.

## Commands

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts video-preprocess-plan \
  --mode image-create-avatar \
  --submitId avatar-detect-1 \
  --imageUri tos-cn-i-tb4s082cfz/k-beauty-host.png \
  --outDir data/jimeng-lab/proof-20260612-video-preprocess-plan

bun packages/jimeng-client/src/browser-proxy-cli.ts video-preprocess-query-plan \
  --submitIds avatar-detect-1,voice-match-1 \
  --outDir data/jimeng-lab/proof-20260612-video-preprocess-query-plan
```

## Status

- Dry-run request construction is implemented and schema-validated with Effect Schema.
- Snapshot coverage exists for image/avatar pre-check, voice recommendation, audio detect, audio silence, and result query shapes.
- Generic `request-plan-compare` can compare these request bodies against passive raw CDP/UI captures.
- Live submit remains approval-gated because `/pre_process` can create provider-side task state, and result lookup requires real task ids from that submit flow.
