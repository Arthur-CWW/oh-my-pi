# Jimeng Mix Audio Plan

Purpose: promote the high-value V1 `/mweb/v1/mix_audio_video` and `/mweb/v1/mix_audio_videos` gaps from opaque blockers to dry-run, compare-ready request plans for applying a voice/audio track to generated UGC video items.

## Evidence

- Static frontend evidence: `data/jimeng-lab/proof-20260611-static-locate-media-helper-blockers/`
- The frontend `submitMixAudioVideoTask(e)` transform:
  - removes `babiParam` from the POST body
  - snake-cases the remaining body
  - sends `JSON.stringify(babiParam)` as query param `babi_param`
- New command: `jimeng-browser-proxy mix-audio-plan`
- Generic compare support now checks optional `query_params` in addition to POST body paths.

## Proof Command

```bash
/Users/arthur/.local/share/mise/shims/bun packages/jimeng-client/src/browser-proxy-cli.ts mix-audio-plan \
  --audioVid v0ugcvoice123 \
  --videoItemId generated-video-item-123 \
  --babiParam '{"pf":"7","scene":"ugc_voice_over"}' \
  --outDir data/jimeng-lab/proof-20260611-mix-audio-plan
```

Latest local proof:

- raw plan: `data/jimeng-lab/proof-20260611-mix-audio-plan/raw/mix-audio-plan-20260611130740-dry-run-plan.json`
- normalized summary: `data/jimeng-lab/proof-20260611-mix-audio-plan/normalized/mix-audio-plan-20260611130740-summary.json`
- endpoint: `/mweb/v1/mix_audio_video`
- mode: `single`
- input count: `1`
- query param keys: `babi_param`
- live submit: `false`

## Compare Command

After a passive UI capture:

```bash
/Users/arthur/.local/share/mise/shims/bun packages/jimeng-client/src/browser-proxy-cli.ts request-plan-compare \
  --plan data/jimeng-lab/proof-20260611-mix-audio-plan/raw/mix-audio-plan-20260611130740-dry-run-plan.json \
  --rawNetwork data/jimeng-captures/<capture>/raw-network.jsonl \
  --outDir data/jimeng-lab/proof-20260611-mix-audio-compare
```

## Verification

```bash
/Users/arthur/.local/share/mise/shims/bun test packages/jimeng-client/test/mix-audio.test.ts packages/jimeng-client/test/request-plan-compare.test.ts
```

Result: `8 pass, 0 fail`.

Live replay remains intentionally disabled until a matching UI capture is compared and explicit approval is given, because these endpoints create provider task state.
