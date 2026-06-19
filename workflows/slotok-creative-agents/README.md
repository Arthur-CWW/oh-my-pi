# slotok-creative-agents

Pi/OMP workflow direction for Slotok creative execution.

## Decision

Slotok does not need to force every creative step through the app daemon. Treat Pi/OMP as an execution lane: launch persona/tool workflows that read Slotok workspace context, run creative/research/provider tasks, and write structured results back as local provider jobs, reference archives, candidates, or export manifests.

The Slotok app remains the local-first workbench and state viewer. Pi/OMP agents are the creative operators.

Use the existing `packages/dynamic-workflows` primitive (`parseWorkflowScript` / `runWorkflow`) rather than inventing a second workflow DSL. Slotok-specific workflow definitions should be persisted wrappers around dynamic-workflow scripts, arguments, results, and imported records.

## Product lanes

- `brainrot` — Pleometric-style surreal/postmodern shortform creation.
- `ugc-ads` — UGC Studio for making ads: personas, hooks, product demo, proof, CTA, variants, review.

Every workflow prompt should carry one lane and preserve it in output metadata.

## Workflow roles

Recommended personas:

1. **Reference miner**
   - Inputs: local catalog roots, public inspiration manifests, X/article URLs.
   - Output: clean-room mechanics only; no direct reuse of protected pixels/audio/likeness.

2. **Codex analyst**
   - Inputs: prepared frame refs, candidate preview metadata, reference archive metadata.
   - Output: structured observations: hook, pacing, product visibility, caption mechanics, retention risks, reusable mechanics.
   - Auth: prefer Codex/OAuth-capable Pi/OMP runtime when available; do not paste tokens into prompts.

3. **Creative strategist**
   - Inputs: analysis records, product lane, target audience, constraints.
   - Output: angles, scripts, shot lists, prompts, critique notes.

4. **KIE image/video operator**
   - Inputs: approved prompt/spec only; never raw provider inspiration assets unless rights-cleared.
   - Output: provider job records and artifact paths.

5. **Reviewer/editor**
   - Inputs: generated candidates and analysis.
   - Output: verdicts, notes, branch decisions, final timeline/export manifests.

## Slotok handoff contract

Each workflow should return JSON-safe records with:

```json
{
  "lane": "brainrot | ugc-ads",
  "sourcePolicy": "metadata-only | abstract-mechanics | rights-cleared-source",
  "records": [],
  "providerJobs": [],
  "candidatePatches": [],
  "referenceArchives": [],
  "notes": []
}
```

Slotok imports these through daemon routes, not by manually editing SQLite.

## Telemetry contract

Use event sourcing as the browser contract:

- `workflowRuns` stores the durable run snapshot: id, lane, status, script/definition id, args, current phase, counters, result, imported records, and timestamps.
- `workflowEvents` is append-only: phase/log/agent-start/agent-progress/agent-end/artifact/result/import/error events linked by `runId`.
- The workbench derives "what agents are doing right now" from the latest events instead of trusting one mutable status blob.
- Slotok daemon exposes SSE for live viewing and polling for fallback/replay.

Adapters:

- Dynamic workflows: map `runWorkflow` callbacks directly into events.
- OMP RPC: when Slotok owns an `omp --mode rpc` child process, normalize stdio `AgentSessionEvent` and subagent progress frames into events.
- OMP stats: use `omp stats` / `omp-stats` only for historical usage/cost analytics, not live progress.
- Artifact polling: tail Pi/OMP session JSONL, plans, and artifact dirs into the same event table when Slotok did not launch the process.

## Prompt skeleton

```text
You are a Slotok creative operator.

Lane: <brainrot|ugc-ads>
Workspace: <workspace id>
Inputs:
- <candidate/reference/provider job ids>
- <local manifest paths or prepared frame refs>

Rules:
- Use clean-room mechanics, not direct copying.
- Preserve provenance and rights notes.
- Do not make live provider calls unless live=true, cap is explicit, and the command records a provider job.
- Return JSON-safe output matching the Slotok handoff contract.

Task:
<analysis / creative strategy / generation planning / review>
```

## Implementation path

1. Store Slotok workflow definitions as wrappers around `packages/dynamic-workflows` scripts plus args/result metadata.
2. Keep daemon routes as the persistence boundary for imported workflow outputs.
3. Add import endpoints only for structured workflow outputs.
4. Let Pi/OMP dynamic workflows fan out agents and tools; Slotok visualizes and reviews the results.
5. Use the running workbench at `http://127.0.0.1:47521/ugc-studio/` for manual QA.
