# Overnight harness goal — live orchestration state

Owner: Main session `019f6446-20de` (Fable orchestrator). Arthur asleep; goal set via /goal (workstream harness).
**Resume rule after compaction/restart: read this file + `goal get` + `todo view`, then `irc list` for live workers. Update this file at every wave boundary.**

## Objective (mirror of /goal)
Finish all triaged P1/P2 OMP harness register rows: implemented+tested, verified-flipped, drafted-for-veto (HR-125), or blocked-with-evidence (HR-133 = design probe only). Every wave: focused gates → staged checkpoint-gate commit → promote → register/TASKS receipts.

## Ground state (2026-07-16 early)
- Repo: ~/agents (vendor/oh-my-pi is part of it). HEAD ≥ `10f98df21`. Blessed `16.0.1+fork.dc0a754e24ad` (digest 6bd86664…).
- Landed earlier tonight (commits `911b0594a`, `dc0a754e2`, `80f525be2`): durable-input interrupt wedge fixes, HR-122 responsibility routing, HR-129 slice 1 E2E, HR-135 transport-abort retry, HR-136 revive tool retention, HR-132 `:route` slice 1, HR-124 nested spawn provenance, fleet TARGET_ERROR receipts + prepare-rollout bridge, paste-marker expansion, Agent Hub projection flushes.
- KNOWN RUNTIME CAVEAT: my own running binary predates the HR-136 revive fix — NEVER rely on reviving a PARKED subagent to write; wake idle agents promptly or spawn fresh.
- Test-isolation law: HOME-swap alone leaks the IrcExternalBus global singleton; tests must inject `externalIrcBus` + `OMP_SESSION_CONTROL_DB` (pattern: test/task/park-revive-followup.test.ts).

## Wave 3 (running)
| Agent | Slice | Status |
|---|---|---|
| FleetCanaryClose | Canary re-heartbeat (READY turn) → session-control restart onto blessed → live rollout, max 2 attempts | RUNNING (revived with unblock: canary lost heartbeat row; surface ws:22/surface:415 alive on 668) |
| HR130SetupWorker | DONE — typed JSONL subprocess protocol (spawn-worker-{protocol,entry,client}.ts), `task.isolateSetup` (undefined→hasUI), SIGKILL process-group bounds + RSS sampler, spawn-wave proof p50 0.36 / p95 11.1 / p99 21.0ms (<50), hung child non-blocking; 41 focused tests | DONE |
| HR130ExtBounds | DONE — per-handler AbortSignal→exec process-tree kill, reentrancy coalesce, 256KiB output caps, 32-msg pending bound, 128-record violation ring; 35/35 + 12/12 stress; signal threading at ui-controller:492 + agent-session:6453 | DONE |
| HR130Watchdog | tui/loop-watchdog.ts violation ring + counters + `:loopstats` + phase breadcrumbs | RUNNING |
| HR128SpawnGuide | DONE — docs/fable/spawn-guide.md (workspace root, 11 lines), `task.spawnGuidePath` + `task.isolateSetup` keys, prepareSpawnContext once at TaskTool.execute:884-891, tests 4/4 | DONE |
| HR113Verify | DONE — register row flipped IMPLEMENTED with evidence (fleet.ts:133-155, fleet-cli.ts:316-406, tests 5/5) | DONE |

Wave-3 gate command (union): park-revive/route-inspector/command-mode/spawn-wave/extensions-runner/loop-watchdog/spawn-guide tests + fleet-cli + check:types (coding-agent AND tui).

## Wave 4 (queued, spawn after Wave-3 gate+checkpoint+promote)
- HR-121 browser resource budgets (browser tool acquisition caps + reclaim oldest idle)
- HR-127 tab reuse-by-URL pool (browser guard extension)
- HR-063 compaction visibility (compaction receipt: trigger reason + retained/dropped manifest; agent-session compaction path — unowned then)
- HR-047 durable plans/prompts (persist plan-mode artifacts + spawn prompts durably; check overlap with HR-124 landed records first)
- HR-035/040 build provenance audit (verify landed receipt/build fields satisfy rows; flip or implement gap)
- HR-129 slice 2 (core.providers deny/expiry/budget fragment on the landed policy substrate)

## Wave 5 (queued)
- HR-132 Control Plane provenance pane (reuse :route assembly)
- HR-033 recovery doctor (`omp doctor` alias of fleet recover --dry-run + one-shot repair)
- HR-134 resource sampler (RSS/CPU/uptime columns in fleet status + per-session sampler; feeds HR-133 later)
- HR-125 vim/g-chord grammar — DRAFT DOC ONLY for Arthur's veto
- HR-133 paging design probe — docs/fable/ design doc; NO implementation claim

## Closeout
Final union gate → checkpoint → promote → register/TASKS/handoff receipts → morning report (what shipped, what's blocked+why, what needs Arthur: restarts of his TUIs, HR-125 veto, HR-018/061 quota-policy decisions).

## Receipts so far (Wave 3)
- HR-113 → IMPLEMENTED (register:177) — no code change needed.
- Fleet canary: first attempt BLOCKED_CANARY_UNREACHABLE (no status row; surface alive) → operator revived with re-heartbeat protocol.
- HR-128 → landed (guide 11 lines at workspace root, mtime-cached prepend at TaskTool.execute:884-891, tests 4/4).
- HR-130 ExtBounds: approved narrow ExtensionContext.signal threading at extension-ui-controller.ts:489 + agent-session.ts:6450 (one-liners; durable regions untouched).
