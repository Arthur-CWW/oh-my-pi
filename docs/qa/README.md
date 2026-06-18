# QA Proof Artifacts

This directory holds tracked QA reports. Large or transient proof artifacts such as videos, screenshots, logs, CSVs, and JSON manifests should usually live under ignored `artifacts/`.

Use the `proof-of-work-qa` skill for substantial implementation work, UI/UX changes, API/provider setup, benchmarks, and PR preparation.

## Default Proof Strategy

Pick the proof artifact that best demonstrates the claim:

| Work type | Proof artifact |
|---|---|
| UI/UX | tests, visual QA report, screenshots, short walkthrough video |
| API/provider/integration | fixture or snapshot test, dry-run contract proof, redacted logs, optional capped live smoke |
| Benchmark/model comparison | markdown report, CSV/JSON results, input manifest, cost/latency/error summary |
| CLI/backend/data | unit tests, smoke command, schema validation, before/after output, saved JSON/logs |

## Report Requirements

Every QA report should include:

- exact command and cwd used to generate it
- input data or fixture paths
- pass/fail findings
- proof artifact paths
- skipped expensive/live checks and how to run them manually
- enough context for a reviewer to avoid redoing the investigation

## Current Reports

- `slotok-visual-qa.md` — Slotok UI visual QA with screenshots and reviewer walkthrough video under `artifacts/slotok-visual-qa/latest/`.

