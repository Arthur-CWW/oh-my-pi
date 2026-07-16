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

## Day wave (2026-07-16, post-goal — Arthur awake)
Landed: HR-113 flip; morning regs HR-139 bookmarks (:bookmark/:bookmarks + store, DONE), HR-140 Enter-preview modality (DONE, register flipped), HR-141 kernel ownership+doctor scanner (test-green; live reap pending), HR-143 fetch dedupe (DONE — finding: mcp fetch is the OUTER cockpit harness's injection, OMP is clean; regression pins it; overlap matrix in harness-slimming.md). HR-125 grammar ~90% (implementer capped; HR125Finish closing 2 command-mode failures + audit). In flight: ToolProvenance (HR-142 :tools + origin metadata), HR144ReloadRoster (view-reload roster seeding).
New rows: HR-142/143/144/145. Facts recorded: effect@4.0.0-beta.92 in; lifecycle core not Scope-managed (HR-145); Kimi lane approved by Arthur but quota-blocked (projected-empty) at first attempt; codex ~15 tok/s today.
Pending after workers land: union gate → checkpoint → promote → live kernel reap via doctor --apply → HR-141/125/142/144 register receipts.

## Evening wave (2026-07-16)
Arthur UX talk-through → HR-147 (nvim colon + Tab-accept + Ctrl-S scroll), HR-148 (generic table+preview views; no history dumping), HR-149 (node_repl retirement to opt-in; eval is the primitive), HR-150 (upstream Pi dynamic-tools port), HR-151 (ui.dismiss vs app.interrupt — his ctrl+q remap silently broke every Esc-to-exit surface). Cockpit fetch MCP removed from ~/.claude.json directly.
INCIDENT: mass-park killed the 4 fresh evening spawns ~3min after launch (job tracker lost them; all subagents' park timestamps identical) — respawned as HR149NodeRepl2/HR148ViewScout2/HR150DynamicTools2 (implementer responsibility, dogfooding HR-122 alias advisory); HR147ColonMode revived and running with HR-151 folded in — watch whether its writes land (parked-revive tool-loss risk on this session's old binary). Investigate the mass-park mechanism when waves settle.

Evening wave status: HR-147 landed (colon-anywhere, Tab-accept, Hub fullscreen alt-buffer fixes Ctrl-S snap; 80 tests) + HR-151 core (ui.dismiss action + matchesUiDismiss, CustomEditor onInterrupt/onEscape split) — HR147ColonMode family finishing modal-surface audit via delegates. HR-149 timed out at the subprocess wall (2400s; typed SpawnWorkerError = HR-130 isolation working) with edits in tree → NodeReplFinish closing. HR-148 scout timed out AFTER completing — packet salvaged from journal to local/hr148-scout-packet.json (implementation next wave). HR-152 HudCompression + HR-150 dynamic tools + HR-026 DetachSurvivalPlan running. Ownership lesson recorded: zero-diff ≠ dead (HR147ColonMode was investigating; my duplicate spawns caused a 3-way collision, resolved by restoring single ownership). Subprocess timeoutSec needs headroom at 15tok/s codex throughput — use 3600 for Sol-lane spawns.

## Evening closeout (commit 4ed1d1ff5, blessed 16.0.1+fork.4ed1d1ff5a27)
Landed: HR-147/151 (193+99 tests), HR-149 (+builtin .mcp/mcp.json discovery fix), HR-150 dynamic tools, HR-152 partial (preview effort pending), HR-026 design B doc materialized from salvaged yield, HR-148 packet at local/hr148-scout-packet.json. Mega-gate 213/22 files + staged snapshot. MYSTERY SOLVED: the evening mass-park was MY session's fleet upgrade to a9b767363 (same-PID reexec parks the child family) — expected mechanism, poor child continuity; candidate register row: child-family survival across parent reexec. Recurring worker-death modes tonight: subprocess wall-clock at codex ~15tok/s (raise timeoutSec or split scope), yield-report swallowing, parked-no-reviver. Next wave queue: HR-148 implementation (packet ready), HR-026 design B implementation, HR-152 preview-effort verification, HR-137/138, HR-129 slices 3-5, HR-133 decision (Arthur), HR-145 Scope slices.

## Night-2 closeout (commit b97c2a1cb, blessed 16.0.1+fork.b97c2a1cb3c0)
Landed: HR-148 slice 1 (Scope-managed TablePreviewComponent, /agents migrated, finalizers proven), HR-152 tier revision (spelled variants, compact-vs-standalone tiers, bullet audit — Arthur's density rule), HR-156 full polish batch (wrap fix, mouse default-off, [/] dedup, peer models/prompts/scrollable previews), HR-153 + HR-155 design docs materialized from salvaged yields. HR-157 registered (8 pre-existing tui timing failures, HEAD-reproduced). Rollout of b97c2a1c auto-upgraded dotfiles-wg6w3g live (bridged-session rollout working in production); dotfiles-9yuh4d timed out on recovery (typed, bounded, remaining untouched) — investigate with HR-138.
SYSTEMIC WORKER PATTERN tonight: subprocess wall-clock consistently fires AFTER yield submission (work never lost, reports eaten; salvage-from-journal is routine now) — the post-yield shutdown hang is register-worthy alongside parked-no-reviver. Next wave queue: HR-026 daemon impl, HR-148 slice 2 (:tools + Hub migration + history-dump removal), HR-152 preview-effort verify, HR-153/155 v1 slices (Arthur review first), HR-137/138, HR-157, HR-129 s3-5, HR-133 decision.
