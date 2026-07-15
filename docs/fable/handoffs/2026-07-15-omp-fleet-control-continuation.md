# OMP fleet-control continuation handoff — 2026-07-15

Open this before taking any fleet action. This is the current continuation boundary for a new Main orchestrator. The repository is intentionally dirty; preserve unrelated user/agent work.

## Stop point and honest release state

Observed at this handoff boundary:

- Repository `HEAD` is `5ddf0c492` (`docs(primer): add CEV-oriented PREFERENCES doctrine; link from INTENT/LINEAGE`). The working tree has extensive unrelated staged/unstaged/untracked changes; do not clean or reset it.
- `omp --version` reports `omp/16.0.1+fork.9ad7a32cf2d3`.
- Blessed is `16.0.1+fork.9ad7a32cf2d3`, digest `632b7d0f8f8dd81f1dee2b9f7f0fd4adc086a1b0c54d05d488d33e43df7315b4` (`632b7d0f…`). Promotion is **BLESSED**. This is not fleet convergence.
- Automatic rollout is **FAILED/INCOMPLETE**: dead test fixture peer `project-0auuza` (`session-runner-test`, zero digest, PID gone) was selected before the real canary. `FleetRegistryIsolationFix` is in flight to filter dead-PID/test-fixture/provenance rows and restore isolation. Do not claim rollout success until the fixed path is re-run and health evidence passes.
- The 9ad7 capability advertisement now reports `status`, `prepare-rollout`, and `rollout-checkpoint`. Consolidated fixture lifecycle proof is green at **47 transitions / 92 assertions**; the earlier fleet union was **38/38 suites** before later capability tests.
- The real compatible cmux canary is **workspace:16**, session `019f6419-3bec-7000-ba8f-7e876dac7c36`, on old build `24729baf`, created from the retained digest path. It requires a safe restart/freshness check before retrying.
- The current Main is still the older `24729` build, `working`, and was intentionally skipped. Restart it at a safe boundary; do not force it through an unknown protocol.

The no-flag `omp fleet status` read at this boundary still exposes many `session-runner-test` zero-digest rows. Never use `omp fleet status --all` for this continuation: that view is polluted and can select the exact dead-fixture class that blocked the rollout.

## First actions for the next Main

Run from `~/agents`:

```sh
cd ~/agents
omp --version
git log -8 --oneline --decorate
git status --short --branch
omp fleet status
```

Use `omp fleet status` without `--all`; inspect `SESSION`, `STATE`, `FRESHNESS`, `BUILD`, `VERSION`, `COMPATIBILITY`, and `ROLLOUT`. The old Main is the `working` row on `16.0.1+fork.24729baf...`; do not infer identity from a `session-runner-test` name.

### Restart the old Main safely

`/restart` is the binary handoff. It is a same-PID whole-process re-exec onto the installed binary, preserving draft/queue state and re-adopting eligible children. Identify the Main terminal surface first, then send the command:

```sh
cmux list-workspaces
cmux tree --workspace workspace:2
cmux read-screen --workspace workspace:2 --surface surface:75 --scrollback --lines 80
cmux send --workspace workspace:2 --surface surface:75 "/restart"
cmux send-key --workspace workspace:2 --surface surface:75 Enter
```

At this boundary, `workspace:2` / `surface:75` is the OMP Main session `019f6141-df73-7000-b792-985f12d9db5d` (`π: Continue OMP Overhaul Orchestration`). Re-run `cmux tree` first because cmux refs can move; never send `/restart` to a guessed surface.

After the restart returns to the TUI, verify from `~/agents`:

```sh
omp --version
omp fleet status
```

The expected evidence is a `16.0.1+fork.9ad7a32cf2d3`/`632b7d0f…` Main row with a replacement owner epoch and fresh compatible heartbeat. Those are gates to inspect, not results to assume. `/reload-tui` is view-only (and unavailable in an in-process runner/view); it does **not** swap the binary. Do not use tmux. Persistent servers and the canary live in cmux workspaces 14/15/16.

## Identify and refresh the real canary

The canary is identified by the exact session ID, not by the generic fixture name:

```sh
cmux list-workspaces
CANARY_WS=workspace:16
cmux tree --workspace "$CANARY_WS"
cmux read-screen --workspace "$CANARY_WS" --scrollback --lines 120
omp fleet status
```

Match the exact session ID `019f6419-3bec-7000-ba8f-7e876dac7c36` in the workspace/screen and status roster. Confirm that it is the compatible real cmux peer, not a `session-runner-test` row and not a zero-digest/dead-PID row. The canonical handoff state is `workspace:16`; cmux refs are volatile, so if `cmux list-workspaces` shows the title **OMP Fleet Canary** under another printed ref, set `CANARY_WS` to that ref and re-run the tree/read-screen commands. If the exact row is absent, stale, or still on `24729baf`, do not substitute another peer.

After selecting the workspace containing that exact session, refresh its selected terminal surface at a safe boundary:

```sh
cmux send --workspace "$CANARY_WS" "/restart"
cmux send-key --workspace "$CANARY_WS" Enter
```

Then re-run `omp fleet status` and wait for a fresh heartbeat, changed owner epoch, exact target digest, and compatible capabilities before selecting it.

## Retry after FleetRegistryIsolationFix

Do not retry live rollout until the isolation fix is landed in the installed candidate, its focused gates below pass, and the real canary has been restarted/fresh. First review the plan; dry-run sends no control command:

```sh
cd ~/agents
omp fleet status
omp fleet rollout --blessed --dry-run
```

The dry-run must show the explicit rollout target, N−1, canary/wave ordering, and exclusions/defer reasons. A zero-digest `session-runner-test` row, dead PID, or unknown-provenance fixture in a selected wave is a hard stop; do not work around it by selecting a different fixture.

When the dry-run is clean, retry the explicit canary and serial wave:

```sh
omp fleet rollout --blessed --canary 019f6419-3bec-7000-ba8f-7e876dac7c36 --wave-size 1
```

If the fixed build was not re-promoted and the intended target is still exactly the current 9ad7 release, the equivalent explicit-digest command is:

```sh
omp fleet rollout --digest 632b7d0f8f8dd81f1dee2b9f7f0fd4adc086a1b0c54d05d488d33e43df7315b4 --canary 019f6419-3bec-7000-ba8f-7e876dac7c36 --wave-size 1
```

Keep the printed `ROLLOUT_ID`. Verify only with receipts and source-addressable evidence:

```sh
omp fleet status
omp fleet errors --since 30m --rollout <ROLLOUT_ID>
```

Only `EXECUTION Succeeded` plus intended digest, changed owner epoch, compatible ranges, healthy terminal rollout phase, and no attributable errors is rollout success. Failed checkpoint/restart/recovery/re-adoption/status/health evidence freezes later waves. `BLESSED` alone remains a release-selection result.

## Legacy and incident safety rules

- Legacy sessions need one safe-boundary manual `/restart` (or a future cmux bootstrap command). `/reload-tui` cannot upgrade them. Fleet must not force commands into unknown/legacy protocols.
- The installed cmux extension is hardened after the old extension child repeatedly reached 100% CPU and 4–8.5 GiB RSS. Generator source in nested `vendor/manaflow-ai/cmux` is being synced/amended. Never use tmux; do not treat the old hook incident as an OMP rollout result.
- Performance explorer: `http://omp-perf.localhost:1355`; visual QA artifacts are in package `data/qa`. The measured OMP/process/browser numbers and architecture evidence are in the linked design docs.
- `/context` compatibility was restored and promoted in `1e57`: exact unknown Enter no longer fuzzy-executes `/compact`; the focused proof was 19 tests green. Keep that behavior while doing rollout work.
- Temporary provider posture: never Terra; task default Luna xhigh; Sol medium+ for synthesis/lifecycle; Kimi is fallback only, never primary. Runtime policy design replaces YAML as live authority. Do not hardcode Kimi primary because a temporary Anthropic outage may have expired.

## Focused gates

Run these from `~/agents/vendor/oh-my-pi`. The five fleet files are the minimum rollout gate:

```sh
bun --cwd=packages/coding-agent test test/session/fleet-capability.test.ts test/session/fleet-rollout-plan.test.ts test/session/fleet-rollout-lifecycle.test.ts test/session/fleet-health-rollback.test.ts test/fleet-cli.test.ts
bun --cwd=packages/coding-agent test test/session/fleet-rollout-lifecycle.test.ts
```

Observed at this boundary: the five-file command passed **31 tests / 189 expect calls**; the lifecycle file passed **1 test / 92 expect calls**. The consolidated proof's 47-transition count is the fixture-level transition count, not a claim that the Bun runner reports 47 test cases.

Run the promoted `/context` proof without invoking the TUI package's broad `test/*.test.ts` script:

```sh
bun --cwd=packages/coding-agent test test/slash-commands/session.test.ts
bun --cwd=packages/tui test test/editor-autocomplete-actions.test.ts
```

The two focused files passed **7 + 12 = 19 tests** at this boundary. Then run the focused type/drift gates:

```sh
bun --cwd=packages/catalog run check:types
bun --cwd=packages/ai run check:types
bun --cwd=packages/agent run check:types
bun --cwd=packages/coding-agent run check:types
bun --cwd=packages/tui run check:types
bun --cwd=packages/stats run check:types
bun --cwd=packages/catalog run check:codex-bundle
```

All six typechecks and the Codex drift check were green at this boundary; the drift check reported vendored Codex metadata `325cf161940c4be5d5792dc09940624ba7543b44`. For a commit gate, stage only the intended source and generated artifacts, then run from the vendored repository root so the staged snapshot—not this dirty working tree—is tested:

```sh
bash scripts/checkpoint-gate.sh -- bun --cwd=packages/coding-agent test test/session/fleet-capability.test.ts test/session/fleet-rollout-plan.test.ts test/session/fleet-rollout-lifecycle.test.ts test/session/fleet-health-rollback.test.ts test/fleet-cli.test.ts
```

## What is already landed

The 24729/1e57/9ad line includes typed errors, cmux resume cross-group, tok/s status, image compaction repair, `:id`/`y` yank, colon-from-anywhere with docked errors, shared completion, tool headlines, nested-spawn provenance, durable followups/drafts, browser caps, and fleet control. Treat the fleet rollout as incomplete despite those source/runtime features.

Read these before changing scope:

- `docs/fable/fleet-rollout-design.md` — journals are authority; the controller is a foreground local orchestrator; BLESSED and ROLLOUT are distinct; waves are serial and health-gated.
- `docs/fable/fleet-rollout-runbook.md` — operator command surface and receipts.
- `docs/fable/runtime-policy-design.md` — HR-129 policy-journal authority and apply boundaries.
- `docs/fable/ghostty-memory-design.md` — HR-133 measured memory evidence and page architecture.
- `docs/fable/harness-request-register.md` — HR-115 onward.
- `docs/fable/handoffs/2026-07-14-omp-overnight-continuation-results.md` — landed overnight slices and prior gates.

## Ordered next priorities after fleet dogfood

Do not reorder these around a tempting UI slice:

1. HR-122: retire catch-all `task` responsibility routing.
2. HR-129: runtime policy vertical slice; YAML is bootstrap/import/export, not live authority.
3. HR-130: runner/view split plus event-loop watchdog and SPAWN-wave proof.
4. HR-133: journal paging and memory bounds.
5. HR-131: workstream/progress explorer.
6. Control Plane HR-123/124/125.
7. HR-116–120: todo/reask/commands UX.
8. HR-127: cmux URL-pool cleanup final verification.
9. HR-134: resource sampler/observability.

Do not call any item complete from a design doc alone. Preserve the distinction between design, source, installed binary, canary, and live fleet evidence.

## Final live fleet dogfood receipts — 2026-07-15T14:59:24Z

- **Requested canary:** session `019f660b-a86d-7000-943c-99e8970ccd70`, cmux `workspace:22` / `surface:415`.
- **Verification receipt:** `omp fleet status 019f660b-a86d-7000-943c-99e8970ccd70` printed only the table header and no target row. The cmux surface remained reachable and displayed `omp v16.0.1+fork.6682887346d1` at an idle prompt, but the exact session was absent from the fresh fleet/session-control roster and therefore unreachable through the required restart intent.
- **Restart receipt:** `NOT_ISSUED — CANARY_UNREACHABLE`. Per the operator stop rule, no `/restart`, direct cmux input, or session-control restart was sent after the missing exact fleet row.
- **Substitution check:** the fresh roster contained no idle non-Arthur test session on bridged build `16.0.1+fork.dc0a754e24ad`; all visible compatible alternatives were either on older digests or marked `working`. No substitute was enrolled.
- **Rollout receipt:** rollout ID `none`; dry-run `NOT_ISSUED`; live attempts `0/2`; terminal state `BLOCKED_CANARY_UNREACHABLE`. No `TARGET_ERROR` row exists because rollout execution never began.
- **Digests:** observed canary screen build `16.0.1+fork.6682887346d1`, digest `49cc27f1c3a4837ae2983da9ba6e7b66d0fad6634b5f336ff13c13a1b16b04f5` (as previously advertised for that build); blessed target `16.0.1+fork.dc0a754e24ad`, digest `6bd866643a2f747d2748e53ab66f652dc77c2ea81bb2272a293f5a30065b380b` from `.omp-release-registry.json`.
