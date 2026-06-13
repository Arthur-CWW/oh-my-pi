# Worker A: Mix Audio Typed Service

Brief version: `2026-06-12.wave1.a`

Repo: `/Users/arthur/projects/pi-web-access`

## Read First

- `docs/plans/jimeng-dreamina-cli-goal.md`
- `docs/plans/jimeng-fast-contract-extraction.md`
- `docs/provider/jimeng-api-triage.md`
- `docs/plans/jimeng-parallel-implementation-plan.md`
- `TASKS.md`

## Task

Promote Jimeng mix-audio from dry-run request planning to typed replay-tested service helpers.

This is part of the `persona-voice` packet. It lets us apply generated or cloned audio to generated video items.

## Owned Files

You may edit only:

- `packages/jimeng-client/src/mix-audio.ts`
- `packages/jimeng-client/test/mix-audio.test.ts`

Do not edit:

- `packages/jimeng-client/src/endpoint-registry.ts`
- `packages/jimeng-client/src/browser-proxy-cli.ts`
- `docs/**`
- `TASKS.md`
- snapshots
- unrelated dirty files

Other workers or the parent may be editing the repo. Do not revert work you did not make.

## Implementation Requirements

Add typed service helpers for:

- `POST /mweb/v1/mix_audio_video`
- `POST /mweb/v1/mix_audio_videos`

The helpers should:

- Build requests from `buildJimengMixAudioVideoPlan`.
- Accept `JimengSessionBundle` plus injected `JimengFetch` or `JimengClient`.
- POST with `JimengClient.requestText`.
- Use normal Jimeng web headers: JSON content type, accept, user-agent, origin, referer, cookie, `lan`, `pf`, `loc`, and `appid`.
- Include `babi_param` in the URL query when `plan.queryParams` has it.
- Parse JSON at the boundary.
- Call `assertNoRiskError`.
- Reject nonzero Jimeng `ret` with `jimengError`.
- Return a stable result containing:
  - `endpoint`
  - `httpStatus`
  - `ret`
  - `errmsg`
  - `responseTextSha256`
  - `request`
  - `queryParams`
  - summarized task/result rows
  - raw `body`
- Add summary helpers that avoid signed URLs and raw provider media leakage.

Name suggestions:

- `executeJimengMixAudioVideo`
- `summarizeJimengMixAudioVideoResult`
- `JimengMixAudioVideoResult`
- `JimengMixAudioTaskSummary`

Follow patterns from:

- `packages/jimeng-client/src/video-preprocess.ts`
- `packages/jimeng-client/src/generate-audit.ts`

## Tests

Extend `packages/jimeng-client/test/mix-audio.test.ts`.

Required tests:

- Existing plan tests still pass.
- Single endpoint mocked request-shape test.
- Batch endpoint mocked request-shape test.
- Nonzero provider `ret` rejection test.
- `createJimengHttpTransport` record/replay cassette test.
- Summary redaction test: summary must not include signed URLs or query signatures.

Use mock responses with permissive but realistic rows, for example:

```json
{
  "ret": "0",
  "errmsg": "success",
  "data": {
    "task_list": [
      {
        "task_id": "mix-task-1",
        "status": 20,
        "video_item_id": "video-item-1",
        "audio_vid": "audio-vid-1",
        "result": {
          "item_id": "mixed-video-item-1",
          "video_url": "https://signed.example.invalid/video.mp4?x-signature=secret"
        }
      }
    ]
  }
}
```

## Validation

Run:

```bash
cd /Users/arthur/projects/pi-web-access/packages/jimeng-client
mise exec -- bun test ./test/mix-audio.test.ts
mise exec -- bun run typecheck
```

## Result File

Write:

```txt
data/jimeng-lab/worker-results/mix-audio-result.md
```

Include:

- files changed
- behavior implemented
- commands run, if any
- recommended parent validation commands
- any parent-owned registry/docs changes recommended
- agent id, model, brief version
