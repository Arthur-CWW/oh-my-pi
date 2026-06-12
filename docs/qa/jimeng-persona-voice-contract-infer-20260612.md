# Jimeng Persona/Voice Contract Inference

Date: 2026-06-12

## Purpose

Move the `persona-voice` packet forward without live spend or account mutation by teaching `contract-infer` to consume existing dry-run packet plans that use `endpoint_sequence`.

This covers request-shape scaffolding for:

- `/mweb/v1/dreamina_subject/generate_voice`
- `/mweb/v1/voice/submit_task`
- `/mweb/v1/voice/query_task`
- `/mweb/v1/voice/update`
- `/mweb/v1/voice/delete`
- `/mweb/v1/mix_audio_video`

## Commands

```bash
mise exec -- bun packages/jimeng-client/src/browser-proxy-cli.ts contract-infer \
  --input data/jimeng-lab/proof-20260610-voice-clone \
  --outDir data/jimeng-lab/proof-20260612-persona-voice-contract-infer/voice-clone

mise exec -- bun packages/jimeng-client/src/browser-proxy-cli.ts contract-infer \
  --input data/jimeng-lab/proof-20260610-subject-lifecycle \
  --endpoint /mweb/v1/dreamina_subject/generate_voice \
  --outDir data/jimeng-lab/proof-20260612-persona-voice-contract-infer/subject-voice

mise exec -- bun packages/jimeng-client/src/browser-proxy-cli.ts contract-infer \
  --input data/jimeng-lab/proof-20260611-mix-audio-plan \
  --outDir data/jimeng-lab/proof-20260612-persona-voice-contract-infer/mix-audio
```

## Output

Ignored proof root:

```txt
data/jimeng-lab/proof-20260612-persona-voice-contract-infer/
```

Results:

- voice clone: 5 endpoint groups, 11 JSON documents
- subject voice: 1 endpoint group, 2 JSON documents
- mix audio: 1 endpoint group, 2 JSON documents

Useful inferred flags:

- subject voice: `--imageUri`
- voice clone submit: `--audioVid`, `--name`, `--submitId`
- voice clone query: `--taskIds`
- voice clone update/delete: `--voice-id`
- audio/video mix: `--audioVid`, `--videoItemId`

## Verification

```bash
mise exec -- bun test ./test/contract-infer.test.ts
mise exec -- bunx vitest run test-vitest/contract-infer.snapshot.test.ts -u
```

The committed fixture bundle is under:

```txt
packages/jimeng-client/test/fixtures/contract-infer/persona-voice-mini/
```

Live submit, voice generation, voice clone mutation, and audio/video mix task creation remain approval-gated.
