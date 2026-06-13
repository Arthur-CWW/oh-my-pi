# Jimeng Persona Voice Client Status

Purpose: correct the persona/voice registry state to match the typed client surface that already exists for subject voice and custom voice clone workflows.

## Typed Surfaces

- `generateJimengSubjectVoice` posts `/mweb/v1/dreamina_subject/generate_voice` and summarizes returned audio metadata without leaking signed audio URLs.
- `submitJimengVoiceClone` posts `/mweb/v1/voice/submit_task` for voice clone creation.
- `queryJimengVoiceTasks` posts `/mweb/v1/voice/query_task` for task lookup.
- `updateJimengClonedVoice` and `deleteJimengClonedVoice` post `/mweb/v1/voice/update` and `/mweb/v1/voice/delete`.
- Voice clone helpers use shared transport cassette record/replay tests; subject voice has mocked typed-client coverage and remains live-approval gated.

## Proof

```bash
cd /Users/arthur/projects/pi-web-access/packages/jimeng-client
mise exec -- bun test ./test/subjects.test.ts ./test/voice-clone.test.ts
```

Expected coverage: subject voice request/summary redaction, voice clone submit/query/update/delete request shape, shared transport record/replay for the voice clone sequence, and provider error handling through existing Jimeng client checks.

## Remaining Gate

Live subject voice generation and voice clone submit/update/delete are still not claimed. They require passive UI capture or explicit approval because they can create or mutate account assets and may consume quota.
