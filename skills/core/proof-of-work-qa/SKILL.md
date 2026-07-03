---
name: proof-of-work-qa
description: Plan and produce reviewer-saving QA proof artifacts for completed work. Use for substantial implementation, UI/UX changes, API reversal/setup, provider workflows, benchmarks, PR preparation, or any task where the reviewer needs clear evidence, rerun commands, screenshots, videos, logs, snapshots, CSVs, or reports.
---

# Proof-of-Work QA

Use this skill near the end of substantial work, and earlier if the proof strategy affects the implementation.

The goal is to save reviewer time. Every completed task should leave behind evidence that shows what changed, how it was tested, and how to rerun the proof.

## Core workflow

1. Identify the claim being proved.
   - UI: "this workflow is usable and visually correct."
   - API/provider: "this request/response contract works and is decoded safely."
   - Benchmark: "these variants were compared under stated inputs."
   - Data/CLI/backend: "this command/state transition produces the expected output."
2. Choose the smallest proof artifact that demonstrates that claim.
3. Run normal tests plus task-specific proof.
4. Save artifacts in a stable repo path, usually `docs/qa/`, `artifacts/`, or task-local output dirs.
5. Document exact rerun commands, input data, expected output files, and any cost/live-call caveats.
6. In the final response or PR description, lead with proof artifacts and commands, not prose.

## Artifact matrix

### UI / UX work

Required when practical:

- automated tests: unit/component/snapshot/interaction tests
- visual QA: screenshots or visual diffs at relevant viewports
- video proof: short Playwright/CuaDriver/browser walkthrough showing the changed workflow
- report: markdown with pass/fail findings and artifact paths

Good artifact shape:

```txt
docs/qa/<feature>-visual-qa.md
artifacts/<feature>-visual-qa/latest/*.png
artifacts/<feature>-visual-qa/latest/videos/reviewer-walkthrough.webm
```

The video should behave like a reviewer clicking through the feature: open the screen, exercise changed controls, show key states, and pause briefly where a human would inspect.

### API reversal, provider setup, and integrations

Prefer a proof ladder:

1. Fixture/snapshot test for decoded sample responses.
2. Dry-run or mocked contract test that proves request construction without spending credits.
3. Live smoke only when needed and safe, with concurrency/cost caps.
4. Saved request/response summaries with secrets redacted.

Artifacts can be:

- `docs/qa/<provider>-smoke.md`
- redacted JSON fixtures
- provider logs / manifests
- decoded output snapshots
- command transcript summaries

Do not require expensive live calls for every review. If live calls are costly, risky, or quota-consuming, make the dry-run/fixture proof strong and document what a live smoke would run.

### Benchmarks and model/provider comparisons

Save structured outputs that can be inspected without rerunning:

- markdown table for human review
- CSV/JSON for reproducibility
- input manifest with hashes/paths
- command used to regenerate
- cost/latency/error summary

Good artifact shape:

```txt
docs/qa/<benchmark>-report.md
artifacts/<benchmark>/latest/results.csv
artifacts/<benchmark>/latest/manifest.json
```

### Backend / CLI / data workflows

Use command-level proof:

- tests for logic and edge cases
- smoke command over realistic input
- before/after state or output file
- schema/migration validation when relevant
- log excerpt or saved JSON result

## Expensive or nondeterministic work

For LLM/provider/video-generation work:

- default to dry-run, fixture, cache, or snapshot proof
- record input prompts/configs and content hashes
- decode outputs at the boundary before core code uses them
- save run manifests with provider/model, cost estimate, cache status, and output paths
- run one small live smoke only when the value justifies spend and the user/project rules allow it

If a proof is intentionally not live, say exactly why and provide the command that would run live.

## PR / handoff checklist

Before final response or PR:

- changed files are scoped and unrelated dirty files are called out
- tests and proof commands are listed with pass/fail status
- artifacts are linked by stable local paths
- UI proof includes video when practical
- expensive/skipped tests are explicitly explained
- reviewer can rerun the proof without guessing cwd, env, or command order

Suggested final shape:

Changed:
- ...

Proof:
- command -> passed
- report: ...
- video: ...

Rerun:
- `command here`

Notes:
- skipped/expensive/manual caveats
