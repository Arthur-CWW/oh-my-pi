# Jimeng Mix Audio Typed Client

Purpose: promote the V1 `/mweb/v1/mix_audio_video` and `/mweb/v1/mix_audio_videos` audio/video mix surfaces from dry-run-only planning to typed service helpers with replayable transport coverage.

## Scope

- Added `executeJimengMixAudioVideo` for single and batch mix-audio request plans.
- Builds requests from `buildJimengMixAudioVideoPlan`, including snake-cased bodies and optional `babi_param` query params.
- Uses injected `JimengFetch` / `JimengClient` plus normal Jimeng web headers.
- Parses JSON at the boundary, applies the shared risk-control check, and rejects nonzero Jimeng `ret` envelopes.
- Summarizes task-like rows while redacting signed provider media URLs from summaries.
- Uses the shared Jimeng HTTP transport, so tests can record and replay cassettes without live provider calls.

## Proof

```bash
cd /Users/arthur/projects/pi-web-access/packages/jimeng-client
mise exec -- bun test ./test/mix-audio.test.ts
mise exec -- bun run typecheck
```

Result: 8 passing mix-audio tests plus package typecheck. Coverage includes single request shape, batch request shape, nonzero upstream rejection, summary redaction, and record/replay cassette transport.

## Remaining Gate

Live replay is still not claimed. The next useful proof is passive capture of a frontend single and batch audio/video mix submit, comparison against `mix-audio-plan` / `request-plan-compare`, then one explicitly approved record/replay run through `executeJimengMixAudioVideo` because these endpoints create provider task state.
