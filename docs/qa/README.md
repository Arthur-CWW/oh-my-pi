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

## Packet Proof Handoffs

The packet SOP lives in `docs/plans/new-workstream-subagent-packets.md#repo-wide-packet-workerreviewer-sop`. Packet workers should reference one durable proof path in their output: a package test/fixture, a tracked `docs/qa/*` report, or an ignored `artifacts/<workstream>/<packet>/` bundle. Reviewers should check that the proof matches the claimed behavior, that skipped live/paid checks have an approval gate and manual command, and that the parent/root verification commands are exact.

## Design QA and private-skill extraction reports

For `T-2026-06-13-003`, extraction reports may record:

- local source path, file type, size, and checksum
- extraction command and output path
- private skill path or symlink target
- checklist category names produced
- confirmation that no page text, screenshots, long quotes, or proprietary examples were committed

Keep raw extraction notes and converted text under ignored `data/private-design-skills/`. Managed skill output belongs in the private skills repo, for example `pi-personal-core-skills/skills/refactoring-ui-private/`, not under `docs/qa/`.

For `T-2026-06-13-004`, design QA reports should name the reviewer personas used:

| Persona | Minimum proof |
|---|---|
| Visual hierarchy / composition | screenshot paths plus blocker/medium findings |
| Accessibility / keyboard | focused keyboard/open-state assertions or explicit non-goal |
| State / data wiring | state matrix covering loading/empty/error/selected/disabled where relevant |
| Performance / static analysis | detector/static-output path or concrete skipped reason |
| Proof artifact review | rerunnable command, cwd, artifact paths, and skipped live/expensive checks |

Do not paste protected design-book text into QA reports. Refer to private checklist item names only.

## Current Reports

- `slotok-visual-qa.md` — Slotok UI visual QA with screenshots and reviewer walkthrough video under `artifacts/slotok-visual-qa/latest/`.
- `asmr-seedance-goal2-runbook-20260624.md` — Goal 2 no-spend Seedance I2V planning plus live-access/preflight runbook.

