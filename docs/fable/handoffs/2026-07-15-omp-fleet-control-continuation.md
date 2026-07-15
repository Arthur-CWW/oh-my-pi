# OMP fleet control continuation handoff — 2026-07-15

## Current state

- Blessed release: `omp/16.0.1+fork.9ad7a32cf2d3`; digest prefix `632b7d0f`.
- BLESSED succeeded. Automatic rollout is **INCOMPLETE**: dead test peer `project-0auuza` (`session-runner-test`, zero digest, dead PID `93451`) was selected and control timed out.
- `FleetRegistryIsolationFix` is currently running to isolate tests and revalidate live PID/provenance. Do not claim that live rollout is complete.
- Current Main is working on old build `24729` and was intentionally skipped.

## What landed

- Fleet MVP: capability, status/errors, checkpoint, planner, exact-digest reexec, re-adoption/auto-resume, health/rollback/pin/channel/runbook.
- Fixture proof: 47 transitions / 92 assertions; 38/38 suites.
- Capability advert was fixed in `9ad` to status + prepare-rollout + rollout-checkpoint.
- `/context` safe fix landed in `1e57`: exact unknown Enter cannot fuzzy-run compact; 19 tests.

## Live blocker

- The automatic rollout selected the dead `session-runner-test` peer `project-0auuza` (zero digest, PID `93451`), then control timed out.
- `FleetRegistryIsolationFix` must isolate tests and revalidate live PID/provenance before any live rollout claim.

## Legacy upgrade semantics

- `/reload-tui` is view-only and cannot swap the binary in the current in-process runner/view.
- `/restart` is a whole-process same-PID reexec onto the installed binary with durable draft/queue plus child re-adoption.
- Legacy peers require one safe-boundary manual `/restart` or a future cmux bootstrap. Never force an unknown protocol.

## cmux topology

- Real compatible cmux canary: workspace `16`, session `019f6419-3bec-7000-ba8f-7e876dac7c36`, agent `agents-qqt7gc`, retaining old build `24729` / digest `8ff304…`. Restart it fresh before the dry-run. There is no tmux.
- cmux hook incident and fix: the old generated hook hit 100% CPU and 4–8.5 GiB; the installed extension is hardened. Nested vendor cmux commit `6b7133ddb` landed, and the follow-up working tree adds a portable local path and a nonblocking bounded hook; tests are pending/amend.
- Persistent servers/canary are cmux workspaces `14`/`15`/`16`.
- Performance explorer: http://omp-perf.localhost:1355. QA is under `package data/qa`.
- Design docs: `fleet-rollout-design.md` / runbook, `runtime-policy-design.md`, `ghostty-memory-design.md`.

## Next commands

1. Read this handoff, `docs/fable/fleet-rollout-runbook.md`, and the `T-2026-07-11-001` row in `TASKS.md`.
2. After `FleetRegistryIsolationFix`, gate with `coding-agent check:types` and its focused fleet tests.
3. Commit/promote the fix.
4. Close/recreate cmux workspace `16` using the retained prior release digest if needed; get a fresh session ID via `omp fleet status` (**NO `--all`**).
5. Run `omp fleet rollout --blessed --canary <sessionId> --wave-size 1 --dry-run`; verify that only the canary is eligible.
6. Run the same command live without `--dry-run`; verify a new epoch, the exact blessed digest, and `Healthy`. Only then bootstrap legacy sessions one at a time with safe `/restart`.

## Open ledger

- No Terra. Luna xhigh is bounded; Sol medium+ handles synthesis/lifecycle; Kimi is fallback only.
- YAML replacement design is complete; implementation is pending.
- After fleet dogfood, the open order is: HR-122 role ontology; HR-129 policy vertical slice; HR-130 Runner/View split; HR-133 paging/memory; HR-131 progress explorer; Control Plane HR-123–125; todos/reask HR-116–120; cmux pool HR-127 final; resource HR-134.
