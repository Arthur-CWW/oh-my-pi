# Jimeng Worker Orchestration

This folder is the parent-controlled context for running Jimeng/Dreamina implementation workers in parallel with OMP `task` subagents. The parent/orchestrator is the main GPT-5.5 Codex process; simple implementation and read-only planning workers use `.omp/agents/jimeng-gemini-worker.md` on the Antigravity subscription lane (`google-antigravity/gemini-3.5-flash-low`) by default, with `.omp/agents/jimeng-kimi-worker.md` as the latest-Kimi fallback when Gemini is unavailable or rate-limited. When Gemini is unstable and the slice is still bounded enough for a subagent, fall back to a GPT-5.5 `task` or `reviewer` subagent before pulling the work into the parent.

Parent agent responsibilities:

- Preserve main context for orchestration only: packet selection, brief writing, file ownership, reviewer assignment, validation, status updates, and commits.
- Do not use the parent as the default implementation worker. If implementation can be described as an owned file slice, delegate it to a subagent. Parent implementation should be the exception for tiny integration fixes or shared-contract decisions.
- Keep the goal docs, endpoint registry, snapshots, `TASKS.md`, packet ledger/dashboard, and final commits consistent.
- Assign one implementation worker brief per independent slice, then one fresh review worker brief per non-trivial completed slice.
- Enforce file ownership. Reject patches that touch unassigned files.
- Run quick validation as each accepted worker slice finishes.
- Run full Jimeng validation before committing integrated work.
- Record every implementation/review worker agent id, model, brief version, result path, transcript path, and outcome in `session-log.md`.
- Preserve `agent://<id>` outputs and `history://<id>` transcripts so we can later distill better prompts and workflow rules without loading all details into the parent.
- After a coherent reviewed group validates, run the post-run analysis job through an OMP task subagent to measure time/cost/token/process quality and improve the next pseudo-wave.


Efficiency protocol:
- Use rolling pseudo-waves, not rigid batches. Launch independent implementation/review tasks together when their file ownership is disjoint, but integrate and validate each accepted slice as soon as it finishes. Do not wait for a slow or blocked sibling before updating SQLite and claiming the next independent packet.

- Treat the packet status ledger as the source of truth before launching a worker. Do not re-check a completed or explicitly blocked packet unless the blocker changed or the ledger says the evidence is stale.
- Each packet status must be one of `todo`, `in_progress`, `review`, `done`, or `blocked`, with an exact next command/probe. `blocked` requires a reason and unblock condition; `done` requires parent-observed validation.
- Run implementation and review as separate agents when the implementation is non-trivial: one bounded implementation worker, then one fresh reviewer worker over the patch/result. The parent integrates only after the reviewer reports concrete issues or accepts the slice.
- Keep the parent context thin. Workers return a compact artifact/result; reviewers inspect `agent://<impl-id>` / `history://<impl-id>` and the assigned files instead of making the parent carry the whole transcript.
- The single source of truth for packet/workstream status is the SQLite dashboard DB, currently `data/jimeng-lab/artifact-log.sqlite`. Docs may describe policy and durable summaries, but they must not duplicate live packet status tables. Update packet rows with `jimeng-artifacts packet set|next`; update docs only after the ledger row is written.
- The parent should not inspect full implementation files unless needed to resolve a reviewer finding, validate an integration error, or design a shared contract. Default parent inputs are worker final output, reviewer final output, focused validation output, and packet ledger state.
- After a coherent set of slices is integrated, reviewed, and validated, make a scoped Git commit before starting the next risky/shared wave. The commit boundary is the recovery point across auto-compaction and prevents later waves from re-litigating finished status.
- If the next step is blocked by live spend/capture/account mutation, ask once with the exact command/artifact path. After approval, continue; if not approved, keep work inside the same packet instead of switching to an easier family.
Preferred worker split:

```txt
Parent/orchestrator: GPT-5.5 main process
Simple non-core implementation/read-only packet workers: jimeng-gemini-worker (`google-antigravity/gemini-3.5-flash-low`)
Trickier bounded implementation/review workers: GPT-5.5 `task` / `reviewer` subagents
Fallback when Gemini is unavailable or rate-limited and GPT-5.5 subagents are not the right fit: jimeng-kimi-worker (kimi-latest)
```

Use `jimeng-gemini-worker` for bounded edits that are not foundational for other work: fixture promotion, endpoint-specific schema/client wrappers, packet gap review, small docs/registry deltas, dashboard polish, and low-risk generated-code tightening. Do not use it as the final owner for shared transport, Effect layer design, cross-command CLI architecture, schema strategy, or irreversible provider workflow choices.

The project worker agents pin:

```txt
jimeng-gemini-worker: google-antigravity/gemini-3.5-flash-low
jimeng-kimi-worker: kimi-latest
```

The project worker agent intentionally does not expose `bash`. This prevents simple workers from spending cycles on validation, git inspection, foreground browser automation, or provider commands that the GPT-5.5 parent must run once against the integrated tree.

Project `.omp/config.yml` sets `task.isolation.mode: apfs` on this macOS/APFS workstation. Prefer task isolation for writing workers: set `isolated: true` on each implementation task item so OMP creates an APFS CoW workspace, captures the worker patch, and cleans the workspace after completion. Read-only planning workers can stay non-isolated unless they need scratch writes.

Launch workers from the parent GPT-5.5 process with one OMP `task` batch. Do not shell out to separate `omp` processes for normal worker fan-out.

For isolated workers, do not rely on ignored `data/**` result files as the handoff because the temporary workspace is cleaned and ignored files may not be captured in the patch. Put the full result in the final agent output; use `agent://<id>` / `history://<id>` as the durable handoff. Non-isolated read-only workers may still write result files under ignored `data/**`, for example:

```txt
data/jimeng-lab/worker-results/template-mining-gap-review.md
```

Do not store credentials, cookies, signed URLs, raw provider responses, or private media in worker result files or agent output.


## Worker Guardrails

- Workers do not run tests, typecheck, lint, formatters, git commands, provider CLIs, live captures, or shell probes.
- Workers may edit only their owned files and ignored worker result files.
- Workers must not claim validation passed unless the parent gave them a current observed result.
- Workers should write `commands run: none` unless the assignment explicitly grants command execution.
- Workers should inspect only files/proof paths listed in the brief. Broad `data/**` or package-wide scans are a prompt smell unless the brief explicitly asks for discovery.
- Workers should summarize proof shapes/statuses, not paste raw provider JSON bodies or signed URLs.

## Transcript Review Checklist

After each worker finishes, inspect `history://<id>` for:

- tool-policy violations: tests/typecheck/lint/git/provider commands, broad scans, unassigned file edits;
- false validation claims: “tests pass” without parent-observed output;
- model/runtime issues: rate-limit errors, auth/model alias failures, retries, or truncated output;
- context bloat: rereading whole docs or broad proof trees when a narrow path was assigned;
- unsafe artifact handling: raw provider JSON, signed URLs, cookies, credentials, or private media in result files;
- handoff quality: exact files, behavioral delta, parent validation commands, and central docs/registry recommendations.

Wave 1 finding: no OMP/Gemini rate-limit or model-alias errors were visible in `history://JimengMixAudio`, `history://JimengGenContract`, or `history://JimengTemplateMining`. The main issues were prompt/tooling: Worker A ran tests/typecheck/git despite the parent-owned validation rule, and read-only workers used broad scans. The next wave should keep `bash` unavailable and make each brief list exact inspection paths.

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
