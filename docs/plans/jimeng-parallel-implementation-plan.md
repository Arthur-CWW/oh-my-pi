# Jimeng Parallel Implementation Plan

Use this plan when splitting Jimeng/Dreamina extraction across sub-agents. The parent agent owns orchestration, central registry/docs, final verification, and commits. Workers own isolated module/test slices and should not edit central registry or broad docs unless explicitly assigned.

Standalone worker briefs and the parent runbook live in `docs/plans/jimeng-workers/`:

- `docs/plans/jimeng-workers/README.md`
- `docs/plans/jimeng-workers/parent-monitoring-runbook.md`
- `docs/plans/jimeng-workers/worker-a-mix-audio.md`
- `docs/plans/jimeng-workers/worker-b-generation-contract.md`
- `docs/plans/jimeng-workers/worker-c-template-mining.md`

## Current High-Value State

As of the 2026-06-30 checkpoint, the SQLite packet ledger reports no claimable non-blocked packet. `gen-parity`, `persona-voice`, `reference-controls`, and `template-mining` have already had worker waves and are done, skipped, or parked. `lip-sync-human` is the highest-value remaining packet, but it is approval-gated because the next useful proof uploads an image/avatar, may create provider task state, and may spend credits.

Do not relaunch the historical Wave 1 workers unless a new regression or stale-evidence row explicitly reopens their packet. The next useful parallel work should be created only after either:

- Arthur approves the live `lip-sync-human` proof, producing fresh request/response/artifact evidence for contract promotion; or
- `jimeng-artifacts packet next` returns a new claimable packet that is not `blocked`, `done`, or `skipped`.

## Remaining High-Value Work

1. `gen-parity`
   - Promote the existing `/mweb/v1/aigc_draft/generate` live matrix and `generation-contract` output into a cleaner typed submit/poll/artifact client surface.
   - Remaining gaps: live/captured lip-sync, end-frame, multi-frame, omni-reference generation examples; `/mweb/v1/mpack_image` exact caller shape.

2. `persona-voice`
   - Correct registry state for already-typed subject voice and voice-clone helpers.
   - Promote audio/video mix from dry-run plan to typed replay-tested service for applying a generated voice/audio track to one or more generated videos.
   - Remaining live gates: subject voice, voice clone submit/update/delete, and mix-audio all create or mutate provider state and need passive capture or explicit approval.

3. `lip-sync-human`
   - Pre-process submit/result helpers are typed and replay-tested.
   - Remaining gap: one approved or captured talking-head submit/poll/download flow, then promote the observed response into typed services.

4. `reference-controls`
   - Pose/depth/canny/image description/object mask are typed.
   - Remaining gap: approved or captured reference-profile/person-swap generation proof around omni-reference or related generation modes.

5. `template-mining`
   - Explore/profile/template details are partially typed.
   - Remaining gaps: CapCut/Jimeng template search, batch collection rows, presets, preset detail, and hook/caption/template extraction from usable rows.

## Parallel Split Rules

- Parent owns:
  - `packages/jimeng-client/src/endpoint-registry.ts`
  - `docs/provider/jimeng-api-triage.md`
  - `docs/plans/jimeng-dreamina-cli-goal.md`
  - `TASKS.md`
  - Vitest endpoint/packet snapshots
  - final test/typecheck/diff verification and scoped commits
- Workers should own disjoint source/test pairs, for example:
  - mix-audio worker: `packages/jimeng-client/src/mix-audio.ts`, `packages/jimeng-client/test/mix-audio.test.ts`
  - generation-contract worker: `packages/jimeng-client/src/generation-contract.ts`, `packages/jimeng-client/test/generation-contract.test.ts`
  - template-mining worker: CapCut/template source and tests only, no central registry edits
- Workers must not revert unrelated repo changes or edit files outside their ownership.
- Workers should return: files changed, commands run if any, summary of behavior, recommended parent validation commands, and any central registry/docs changes the parent should make.

## Next Parallel Wave Policy

Historical Wave 1 (`mix-audio`, `generation-contract`, and `template-mining`) is complete; see `docs/plans/jimeng-workers/session-log.md`. The next write worker should be a `lip-sync-human` contract-promotion worker, but only after the parent has gathered an approved live proof bundle. Its likely ownership should be limited to the observed contract files, for example:

- `packages/jimeng-client/src/browser-session.ts` only if the UI submit path needs a small fix from the proof;
- `packages/jimeng-client/src/lip-sync.ts`;
- `packages/jimeng-client/src/video-preprocess.ts`;
- focused tests under `packages/jimeng-client/test/lip-sync*.test.ts` or `video-preprocess.test.ts`.

The parent still owns central registry, triage docs, `TASKS.md`, packet ledger writes, and Vitest snapshots. If approval is not granted, do not switch to low-value supporting reads merely to keep workers busy.

## GPT-5.5 Parent / OMP Subagent Orchestration

Follow the repo-wide packet SOP in `docs/plans/new-workstream-subagent-packets.md#repo-wide-packet-workerreviewer-sop`. This Jimeng plan keeps only Jimeng-specific ownership, launch, and verification details.

### Jimeng-specific ownership deltas

- Parent owns `packages/jimeng-client/src/endpoint-registry.ts`, provider triage/goal docs, `TASKS.md`, endpoint/packet snapshots, final integration verification, and scoped commits.
- Workers own only their named source/test/proof slice, such as `mix-audio`, `generation-contract`, or `template-mining`.
- Excluded unless explicitly assigned: central registry, provider triage docs, root/package manifests, snapshots, unrelated dirty files, credentials, cookies, signed URLs, raw provider responses, and live quota-spending calls.
- Worker output should add any parent-owned registry/docs changes as recommendations, not inline edits.

### OMP launch and handoff

- Launch workers from the GPT-5.5 parent process with OMP `task` subagents, not shell-launched `omp` processes.
- Use `jimeng-gemini-worker`; fall back to `jimeng-kimi-worker` for the same bounded slices if Gemini is unavailable or rate-limited.
- Prefer `isolated: true` for implementation/write workers on this APFS workstation; keep read-only planning workers non-isolated unless they need scratch writes.
- Durable handoff is `agent://<id>` / `history://<id>` plus the returned patch. Non-isolated read-only workers may also write ignored notes under `data/jimeng-lab/worker-results/<packet>-<worker>-result.md`.

### Jimeng root-run validation

After approved worker patches are integrated, the parent/root should run:

```bash
cd /Users/arthur/agents/packages/jimeng-client
mise exec -- bun run test
mise exec -- bun run test:vitest
mise exec -- bun run typecheck
cd /Users/arthur/agents
git diff --check
```

For smaller packets, workers should recommend the narrowest package-local subset first, then the parent decides whether to run the full Jimeng validation above.

### First OMP Worker Briefs

#### Worker A: Mix Audio Typed Service

Owned files:

- `packages/jimeng-client/src/mix-audio.ts`
- `packages/jimeng-client/test/mix-audio.test.ts`

Task:

Promote `/mweb/v1/mix_audio_video` and `/mweb/v1/mix_audio_videos` from dry-run plans to typed service helpers using the existing plan builder. Add Jimeng fetch/session injection, nonzero-`ret` rejection, result summaries, and shared transport record/replay tests. Do not edit registry/docs/snapshots.

Ready-to-run brief:

```txt
Repo: /Users/arthur/agents

Read first:
- @docs/plans/jimeng-dreamina-cli-goal.md
- @docs/plans/jimeng-fast-contract-extraction.md
- @docs/provider/jimeng-api-triage.md
- @docs/plans/jimeng-parallel-implementation-plan.md
- @TASKS.md

Task:
Promote Jimeng mix-audio from dry-run request planning to typed replay-tested service helpers.

Owned files:
- packages/jimeng-client/src/mix-audio.ts
- packages/jimeng-client/test/mix-audio.test.ts

Do not edit:
- packages/jimeng-client/src/endpoint-registry.ts
- packages/jimeng-client/src/browser-proxy-cli.ts
- docs/**
- TASKS.md
- snapshots
- unrelated dirty files

Implementation requirements:
- Add execute-style helpers for /mweb/v1/mix_audio_video and /mweb/v1/mix_audio_videos.
- Build requests from buildJimengMixAudioVideoPlan.
- Accept JimengSessionBundle plus injected JimengFetch or JimengClient.
- POST with JimengClient.requestText and normal Jimeng web headers.
- Include babi_param query when plan.queryParams has it.
- Parse JSON at the boundary, call assertNoRiskError, and reject nonzero ret with jimengError.
- Return endpoint, httpStatus, ret, errmsg, responseTextSha256, request, queryParams, summarized task/result rows, and raw body.
- Add summary helpers that avoid signed URLs/raw provider media leakage.

Tests:
- Existing plan tests must still pass.
- Add mocked single submit request-shape test.
- Add mocked batch submit request-shape test.
- Add provider ret error rejection test.
- Add createJimengHttpTransport record/replay cassette test.

Do not run:
- tests
- typecheck
- lint
- formatters
- project-wide commands

Parent validation after integration:
- cd /Users/arthur/agents/packages/jimeng-client
- mise exec -- bun test ./test/mix-audio.test.ts
- mise exec -- bun run typecheck

Final response:
- files changed
- commands run, if any
- recommended parent validation commands
- any parent-owned registry/docs changes recommended
```

#### Worker B: Generation Contract Promotion Plan

Read-only unless explicitly promoted later.

Task:

Inspect `packages/jimeng-client/src/generation-contract.ts`, generation client/capture code, and tests. Return the smallest no-live-spend implementation slice that would turn saved live generation proofs into a cleaner typed submit/poll/artifact client surface. Include exact file ownership and parent validation commands.

Ready-to-run brief:

```txt
Repo: /Users/arthur/agents

Read first:
- @docs/plans/jimeng-dreamina-cli-goal.md
- @docs/plans/jimeng-fast-contract-extraction.md
- @docs/provider/jimeng-api-triage.md
- @TASKS.md

Task:
Plan the smallest useful no-live-spend implementation slice for promoting saved /mweb/v1/aigc_draft/generate live matrix proofs into a cleaner typed submit/poll/artifact client surface.

Mode:
Read-only. Do not edit files.

Inspect:
- packages/jimeng-client/src/generation-contract.ts
- packages/jimeng-client/test/generation-contract.test.ts
- packages/jimeng-client/src/client.ts
- packages/jimeng-client/src/capture.ts
- packages/jimeng-client/src/browser-proxy-cli.ts generation-related commands only
- data/jimeng-lab/proof-20260612-live-generation-matrix/ if present

Return:
- what typed generation surfaces already exist
- what is missing
- proposed API names/types/functions
- exact files a later worker would own
- tests to add/update
- acceptance commands
- risk/approval notes
```

#### Worker C: Template Mining Gap Review

Read-only unless explicitly promoted later.

Task:

Inspect CapCut/Jimeng template code and proof references. Classify remaining blocked template endpoints into: implementable from existing fixtures, needs passive UI capture, or back burner. Return exact next capture commands or implementation file ownership.

Ready-to-run brief:

```txt
Repo: /Users/arthur/agents

Read first:
- @docs/plans/jimeng-dreamina-cli-goal.md
- @docs/plans/jimeng-fast-contract-extraction.md
- @docs/provider/jimeng-api-triage.md
- @TASKS.md

Task:
Classify template-mining gaps and identify any implementable no-live-spend slice.

Mode:
Read-only. Do not edit files.

Inspect:
- packages/jimeng-client/src/capcut-templates.ts
- packages/jimeng-client/test/capcut-templates.test.ts
- docs/provider/jimeng-api-triage.md
- data/jimeng-lab/proof-20260610-capcut-* if present

Endpoints:
- /lv/v1/cc_web/replicate/get_search_words
- /lv/v1/cc_web/replicate/search_templates
- /lv/v1/cc_web/plane/batch_get_collection_templates
- /lv/v1/cc_web/plane/get_collection_presets
- /lv/v1/cc_web/plane/preset_template_detail
- /lv/v1/cc_web/plane/fuzzy_search_templates

Return:
- endpoint-by-endpoint status
- evidence path for each endpoint
- whether existing fixtures are enough
- exact files a later worker would own if implementable
- tests/fixtures/snapshots needed
- recommended passive capture command if capture is required
```
