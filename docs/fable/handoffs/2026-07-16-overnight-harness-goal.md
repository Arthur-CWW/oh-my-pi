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
| HR130Watchdog | DONE — typed violation ring (64, configurable) + counters + `:loopstats` + ui.handle-input/ui.render breadcrumbs; tui 12 + command-mode 17 tests | DONE |
| HR128SpawnGuide | DONE — docs/fable/spawn-guide.md (workspace root, 11 lines), `task.spawnGuidePath` + `task.isolateSetup` keys, prepareSpawnContext once at TaskTool.execute:884-891, tests 4/4 | DONE |
| HR113Verify | DONE — register row flipped IMPLEMENTED with evidence (fleet.ts:133-155, fleet-cli.ts:316-406, tests 5/5) | DONE |

Wave-3 gate command (union): park-revive/route-inspector/command-mode/spawn-wave/extensions-runner/loop-watchdog/spawn-guide tests + fleet-cli + check:types (coding-agent AND tui).
## Wave 4 (RUNNING — spawned after Wave-3 checkpoint `a729a3368`, blessed `16.0.1+fork.a729a3368743`)
| Agent | Slice |
|---|---|
| HR121BrowserBudgets | per-session/global tab caps + oldest-idle reclaim + typed refusal |
| HR127TabPool | reuse-by-URL, idle TTL sweep, ownership labels, `:tabs` |
| HR063CompactionVisibility | typed compaction receipts + /compact summary (Sol; agent-session edits require Main sign-off with line ranges) |
| HR047DurablePlans | audit-then-implement durable plan artifacts |
| HR035BuildProvenance | audit HR-035/040 clauses; implement small gaps only |
| HR129Slice2 | core.providers deny/expiry posture fragment + enforcement at spawn admission |

Wave-4 progress: HR-063 DONE (typed compaction receipts, emission agent-session.ts:9466/11394, 11 tests; protected regions untouched). HR-047 DONE-partial (plan-artifact schema + plan:// handler + approved-plan persistence + restore-after-replay; open: diagnostic link to plan revision; row IMPLEMENTED-PARTIAL). HR-035/040 DONE (buildVersion on DiagnosticEvent/error cards/fleet rows/TARGET_ERROR; rows flipped; 42 tests). HR-121/127 DONE via BrowserSeamCloser after two request-cap deaths (56/0 tests; externals exempt, process-local reclaim, maxOwnedGlobal kept; keys browser.maxTabsPerSession=4/maxGlobalTabs=12/tabIdleTtlMs=600000; :tabs command). HR-129 slice 2 DONE (core.providers deny fragment, projection-time expiry, receipt provenance, CLI timing flags, 54/0 + process proofs).

Wave-5 progress: HR-134 DONE (one-ps-call sampler; RSS_MB/CPU%/UPTIME columns; 8 tests). HR-125 draft at docs/fable/drafts/2026-07-16-control-plane-grammar.md (84 lines, veto checklist). HR-133 probe at docs/fable/drafts/2026-07-16-rss-paging-probe.md (real measurements: idle runners 160-307MiB, WebKit Malloc dominant; row stays REQUESTED). HR-033 DONE (omp doctor + --apply safe subset: prune dead peers, clear dead-pid promote lock; 24 tests incl. fleet-cli). HR-132 pane in flight.

Fleet canary state: OLD canary 019f660b re-heartbeated via cmux READY turn but /restart reexecs its pinned 668 image — bootstrap-legacy gap confirmed, documented, left as-is. NEW canary 019f6699 (cmux ws:24 fleet-canary-a729, plain `omp` = installed binary) enrolled on 1ecb51b1/a729a336. FINDING: idle peers drop from the fleet roster after ~40min (both canaries went "unreachable" this way — idle-first rollout is self-defeating; register follow-up). Closeout promote 809de128c/fac4d546 done; live rollout 4e9c87ee produced typed TARGET_ERROR (receipt surfacing WORKS, no freeze) but target-side prepare-rollout fails in 27ms with swallowed error "Unknown control failure", nothing in canary journal — PrepareRolloutUnknown (Sol) debugging. E2E proof plan: fix → promote N+1 → restart canary via cmux /restart (plain-omp canary reexecs installed binary, unlike pinned 668 one) → docs-receipts commit promotes N+2 → live rollout N+1→N+2.

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
