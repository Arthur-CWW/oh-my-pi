# Jimeng Lip-Sync Preprocess Client Promotion

Date: 2026-06-12

## Scope

Packet: `lip-sync-human`

This pass promoted the existing video pre-process dry-run request builders into replayable typed service helpers:

- `submitJimengVideoPreprocess`
- `fetchJimengVideoPreprocessResults`
- `summarizeJimengVideoPreprocessSubmitResult`
- `summarizeJimengVideoPreprocessResultLookup`

The implementation keeps the provider boundary permissive: it validates the Jimeng envelope, rejects nonzero `ret`, preserves the raw JSON body for later promotion, and summarizes task-like rows by `submit_id` / `scene` / `status` when present.

## Safety

No live Jimeng pre-process calls were made in this pass. Tests use mocked fetch plus the shared Jimeng HTTP cassette transport in `record` and `replay` modes.

Live use remains approval-gated because `/mweb/v1/video_generate/pre_process` creates provider task state, and useful `/mweb/v1/video_generate/mget_pre_process_result` calls need task ids from a captured or approved pre-process flow.

## Verification

```bash
mise exec -- bun test ./test/video-preprocess.test.ts
mise exec -- bun run typecheck
```

Focused verification passed. `mise` printed a sandbox cache-write warning for `~/.cache/mise`, but the tests and typecheck completed successfully.

## Next Probe

Use the saved packet manifest at `data/jimeng-lab/proof-20260612-lip-sync-human-live-packet/normalized/packet-plan/packet-manifest.md` to request approval for one passive capture or approved live pre-process flow. After that, replay the observed request through the new service helpers and update the response contract from the saved cassette.
