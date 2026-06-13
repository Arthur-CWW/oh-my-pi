# Jimeng Worker Orchestration

This folder is the parent-controlled context for running Jimeng/Dreamina implementation workers in parallel with OMP `task` subagents. The parent/orchestrator is the main GPT-5.5 Codex process; workers use `.omp/agents/jimeng-gemini-worker.md` on Gemini 3.5 Flash.

Parent agent responsibilities:

- Keep the goal docs, endpoint registry, snapshots, `TASKS.md`, and final commits consistent.
- Assign one worker brief per independent slice.
- Enforce file ownership. Reject patches that touch unassigned files.
- Run quick validation as each worker finishes.
- Run full Jimeng validation before committing integrated work.
- Record every worker agent id, model, brief version, result path, transcript path, and outcome in `session-log.md`.
- Preserve `agent://<id>` outputs and `history://<id>` transcripts so we can later distill better prompts and workflow rules.
- After the wave finishes, run the post-run analysis job through an OMP task subagent to measure time/cost/token/process quality and improve the next wave.

Preferred worker agent:

```txt
jimeng-gemini-worker
```

The project agent pins:

```txt
model: gemini-3.5-flash
```

Launch workers from the parent GPT-5.5 process with one OMP `task` batch. Do not shell out to separate `omp` processes for normal worker fan-out.

Worker result files should be written under ignored `data/**`, for example:

```txt
data/jimeng-lab/worker-results/mix-audio-result.md
```

Do not store credentials, cookies, signed URLs, raw provider responses, or private media in worker result files.

## Session Tracking

Every worker should run with an explicit stable task id:

```txt
JimengMixAudio
JimengGenContract
JimengTemplateMining
```

Record the agent id in `docs/plans/jimeng-workers/session-log.md` before launch and update it after completion. Use `agent://<id>` for the final output artifact and `history://<id>` for the transcript.

## Metrics To Capture

Capture these if OMP exposes them in task details, agent artifacts, transcripts, logs, or exports:

- wall-clock start/end/duration
- model/provider
- prompt/brief version
- input tokens
- output tokens
- cached tokens, if reported
- tool calls by type
- command count
- files read
- files edited
- recommended validation commands
- retry count
- estimated cost
- final status: success, partial, failed, abandoned
- integration outcome: accepted, accepted-with-edits, rejected
- parent validation time

If OMP does not expose cost directly, record token counts and model id so cost can be computed later from provider pricing.

## Context Efficiency Rules

- Workers read only the docs and files listed in their brief.
- Workers should not re-summarize the whole goal; they should implement their slice.
- Workers should put detailed notes in their ignored result file, not in chat output.
- Parent summarizes only deltas: changed files, validation result, blocker, next action.
- If a worker discovers missing context, it should ask for one precise file or fact rather than broad repo exploration.

## Wave 1

| Worker | Mode | Brief | Write scope |
|---|---|---|---|
| A | implementation | `worker-a-mix-audio.md` | `src/mix-audio.ts`, `test/mix-audio.test.ts` |
| B | read-only planning | `worker-b-generation-contract.md` | none |
| C | read-only planning | `worker-c-template-mining.md` | none |

Parent-owned after workers finish:

- `packages/jimeng-client/src/endpoint-registry.ts`
- `docs/provider/jimeng-api-triage.md`
- `docs/plans/jimeng-dreamina-cli-goal.md`
- `TASKS.md`
- `packages/jimeng-client/test-vitest/__snapshots__/**`

## Quick Validation

For a finished worker, run only the relevant focused checks first:

```bash
cd /Users/arthur/projects/pi-web-access/packages/jimeng-client
mise exec -- bun test ./test/<worker-test>.test.ts
mise exec -- bun run typecheck
```

After integration, run:

```bash
cd /Users/arthur/projects/pi-web-access/packages/jimeng-client
mise exec -- bun run test
mise exec -- bun run test:vitest
mise exec -- bun run typecheck
cd /Users/arthur/projects/pi-web-access
git diff --check
```
