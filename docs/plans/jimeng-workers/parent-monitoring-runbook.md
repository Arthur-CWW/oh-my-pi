# Parent Monitoring Runbook

The parent GPT-5.5 Codex process coordinates OMP `task` subagents running Gemini 3.5 Flash by default and integrates their output. If Gemini is unavailable or rate-limited, use the latest-Kimi fallback agent for the same simple implementation slices.

## Start A Wave

Launch workers with the OMP task tool from the parent process. Use one batch so shared context is injected once and workers run in parallel. Use `isolated: true` for implementation/write workers; project `.omp/config.yml` pins `task.isolation.mode: apfs`, so OMP should create an APFS CoW workspace, return a patch/branch result, and clean the temporary workspace. Keep read-only planning workers non-isolated unless they need scratch writes.

Before launching, query the packet ledger:

```bash
cd /Users/arthur/agents
bun packages/jimeng-client/src/artifact-dashboard.ts packet next --db data/jimeng-lab/artifact-log.sqlite
```

If this returns no claimable packet and `lip-sync-human` is still blocked on live upload/submit approval, do not launch a worker wave. The next parent action is the approval request for the live proof. Launch workers only after approval produces fresh proof evidence, or after the ledger returns a non-blocked packet.

Historical Wave 1 batch shape:

```txt
agent: jimeng-gemini-worker  # fallback: jimeng-kimi-worker
context:
  # Goal
  Advance the Jimeng/Dreamina worker wave while GPT-5.5 remains the parent orchestrator.
  # Constraints
  Workers run on Gemini 3.5 Flash via .omp/agents/jimeng-gemini-worker.md by default; fallback workers run on latest Kimi via .omp/agents/jimeng-kimi-worker.md when Gemini is unavailable or rate-limited. Workers only touch assigned files, never central registry/docs/TASKS/snapshots unless explicitly assigned, never run tests/typecheck/lint/formatters/project-wide commands, and never make live/paid/mutating/visible-provider calls.
  # Contract
  Parent owns registry/docs/snapshots/final validation/commits. Isolated write workers return patches through OMP; read-only workers return findings through agent output.
tasks:
  - id: JimengMixAudio
    isolated: true
    assignment: Read docs/plans/jimeng-workers/worker-a-mix-audio.md and complete only that implementation slice. Put the full result in final agent output; do not rely on ignored data/** files for isolated handoff.
  - id: JimengGenContract
    assignment: Read docs/plans/jimeng-workers/worker-b-generation-contract.md and complete only that read-only planning slice.
  - id: JimengTemplateMining
    assignment: Read docs/plans/jimeng-workers/worker-c-template-mining.md and complete only that read-only planning slice.
```

Record planned agent ids in `docs/plans/jimeng-workers/session-log.md` before launch. Do not reuse completed historical ids for new work.

## Monitor

Update `docs/plans/jimeng-workers/session-log.md` when each worker starts, finishes, fails, or is abandoned.

Check worker status through OMP task/job/IRC state:

```txt
job list
irc list
agent://JimengMixAudio
history://JimengMixAudio
```

Check worker-owned diffs in the main repo after a writing worker finishes:

```bash
cd /Users/arthur/agents
git diff -- packages/jimeng-client/src/mix-audio.ts packages/jimeng-client/test/mix-audio.test.ts
```

Reject a worker result if it:

- edits unowned files
- reverts unrelated changes
- changes central registry/docs/snapshots
- adds live provider calls to tests
- stores credentials, cookies, signed URLs, or raw provider responses
- weakens schema validation without a reason

## Quick Validation

For a code worker after integrating/accepting its owned-file edits:

```bash
cd /Users/arthur/agents/packages/jimeng-client
mise exec -- bun test ./test/<worker-test>.test.ts
mise exec -- bun run typecheck
```

For read-only workers, inspect their output artifacts/result files:

```txt
agent://JimengGenContract
agent://JimengTemplateMining
data/jimeng-lab/worker-results/generation-contract-plan.md
data/jimeng-lab/worker-results/template-mining-gap-review.md
```

Use `history://<id>` when reviewing process quality.

## Integrate

For code workers:

```bash
cd /Users/arthur/agents
git diff -- packages/jimeng-client/src/mix-audio.ts packages/jimeng-client/test/mix-audio.test.ts
```

Keep only approved owned-file edits. Revert or reject anything outside the worker's assignment.

Parent then updates:

- `packages/jimeng-client/src/endpoint-registry.ts`
- `docs/provider/jimeng-api-triage.md`
- `docs/plans/jimeng-dreamina-cli-goal.md`
- `TASKS.md`
- snapshots as needed

## Final Validation

```bash
cd /Users/arthur/agents/packages/jimeng-client
mise exec -- bun run test
mise exec -- bun run test:vitest
mise exec -- bun run typecheck
cd /Users/arthur/agents
git diff --check
```

## Post-Run Analysis

After the wave is integrated or abandoned, run the post-run analysis as another OMP task subagent using `.omp/agents/jimeng-gemini-worker.md`, or run it in the parent if no subagent is needed. Keep the parent GPT-5.5 process responsible for deciding which lessons become durable docs.

The parent should then review the generated report, update `session-log.md` metrics, and fold durable lessons into:

- `docs/plans/jimeng-workers/README.md`
- `docs/plans/jimeng-parallel-implementation-plan.md`
- `docs/state/agent-iteration-lessons.md`
