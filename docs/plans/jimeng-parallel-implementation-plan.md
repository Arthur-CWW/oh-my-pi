# Jimeng Parallel Implementation Plan

Use this plan when splitting Jimeng/Dreamina extraction across sub-agents. The parent agent owns orchestration, central registry/docs, final verification, and commits. Workers own isolated module/test slices and should not edit central registry or broad docs unless explicitly assigned.

Standalone worker briefs and the parent runbook live in `docs/plans/jimeng-workers/`:

- `docs/plans/jimeng-workers/README.md`
- `docs/plans/jimeng-workers/parent-monitoring-runbook.md`
- `docs/plans/jimeng-workers/worker-a-mix-audio.md`
- `docs/plans/jimeng-workers/worker-b-generation-contract.md`
- `docs/plans/jimeng-workers/worker-c-template-mining.md`

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

## Recommended First Parallel Wave

1. Parent: finish persona/voice registry correction for existing typed helpers and refresh snapshots.
2. Worker A: implement typed replay-tested `mix-audio` service helpers from the existing dry-run plan.
3. Worker B: inspect `generation-contract` and propose the smallest typed submit/poll/artifact promotion that can be done without live spend.
4. Worker C: inspect template-mining gaps and identify which blocked CapCut/Jimeng template endpoint can be promoted from existing fixtures versus which requires passive UI capture.

This wave avoids central-file conflicts while still moving the highest-value packets forward.

## GPT-5.5 Parent / OMP Subagent Orchestration

Use OMP's default `task` subagents for worker fan-out. The main GPT-5.5 Codex process is the parent orchestrator/reviewer; implementation and read-only planning workers use the project agent `.omp/agents/jimeng-gemini-worker.md`, which pins Gemini 3.5 Flash for bounded worker slices.

### Parent Responsibilities

- Keep the active goal, triage docs, endpoint registry, snapshots, and final commits consistent.
- Create one worker brief per packet/slice.
- Assign disjoint file ownership before workers start.
- Reject worker patches that touch unassigned files or mix multiple packets.
- Run final integration tests and update central docs/snapshots after worker patches land.

### Worker Brief Contract

Each worker brief should include:

```txt
Repo: /Users/arthur/projects/pi-web-access
Goal docs:
- @docs/plans/jimeng-dreamina-cli-goal.md
- @docs/plans/jimeng-fast-contract-extraction.md
- @docs/provider/jimeng-api-triage.md
- @TASKS.md

Task:
<one concrete slice>

Owned files:
- <exact file 1>
- <exact file 2>

Do not edit:
- packages/jimeng-client/src/endpoint-registry.ts
- docs/provider/jimeng-api-triage.md
- docs/plans/jimeng-dreamina-cli-goal.md
- TASKS.md
- snapshots, unless explicitly assigned
- unrelated dirty files

Required output:
- files changed
- behavior implemented or findings
- commands run, if any
- recommended parent validation commands
- parent-owned registry/docs changes recommended
```

### OMP Task Launch Pattern

Launch workers from the GPT-5.5 parent process with one `task` batch, not shell-launched `omp` processes. Keep shared context in the task `context` field and pass each worker brief path in its assignment.

Use agent:

```txt
jimeng-gemini-worker
```

The project agent sets:

```txt
model: gemini-3.5-flash
```

Project `.omp/config.yml` sets `task.isolation.mode: auto`. Prefer `isolated: true` for implementation/write workers so OMP creates a CoW workspace, captures the patch/branch result, and cleans the temporary workspace. Keep read-only planning workers non-isolated unless they need scratch writes.

The task batch shape is:

```txt
agent: jimeng-gemini-worker
context: # Goal / # Constraints / # Contract
tasks:
  - id: JimengMixAudio
    isolated: true
    assignment: read @docs/plans/jimeng-workers/worker-a-mix-audio.md and complete only that implementation slice; return the full result in final agent output
  - id: JimengGenContract
    assignment: read @docs/plans/jimeng-workers/worker-b-generation-contract.md and complete only that read-only slice
  - id: JimengTemplateMining
    assignment: read @docs/plans/jimeng-workers/worker-c-template-mining.md and complete only that read-only slice
```

Workers should not run tests, typecheck, lint, formatters, or project-wide commands. The parent runs quick validation after each result and full validation after integration.

For isolated workers, the durable handoff is `agent://<id>` / `history://<id>` plus the returned patch. Do not rely on ignored `data/**` result files from isolated workspaces. Non-isolated read-only workers may still write ignored result files under:

```txt
data/jimeng-lab/worker-results/<packet>-<worker>-result.md
```

Do not store credentials, cookies, signed URLs, or raw provider responses in worker result files or agent output.

### Merge Protocol

1. Worker finishes and reports through `agent://<id>` / `history://<id>` plus any ignored result file.
2. Parent reviews only the worker-owned files and rejects edits outside scope.
3. Parent applies or keeps only the approved owned-file changes.
4. Parent updates central registry/docs/snapshots.
5. Parent runs:

```bash
cd /Users/arthur/projects/pi-web-access/packages/jimeng-client
mise exec -- bun run test
mise exec -- bun run test:vitest
mise exec -- bun run typecheck
cd /Users/arthur/projects/pi-web-access
git diff --check
```

6. Parent commits a scoped checkpoint.

### First OMP Worker Briefs

#### Worker A: Mix Audio Typed Service

Owned files:

- `packages/jimeng-client/src/mix-audio.ts`
- `packages/jimeng-client/test/mix-audio.test.ts`

Task:

Promote `/mweb/v1/mix_audio_video` and `/mweb/v1/mix_audio_videos` from dry-run plans to typed service helpers using the existing plan builder. Add Jimeng fetch/session injection, nonzero-`ret` rejection, result summaries, and shared transport record/replay tests. Do not edit registry/docs/snapshots.

Ready-to-run brief:

```txt
Repo: /Users/arthur/projects/pi-web-access

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
- cd /Users/arthur/projects/pi-web-access/packages/jimeng-client
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
Repo: /Users/arthur/projects/pi-web-access

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
Repo: /Users/arthur/projects/pi-web-access

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
