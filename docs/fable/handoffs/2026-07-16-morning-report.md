# Morning report — overnight harness goal (2026-07-16)

Goal: finish all triaged P1/P2 OMP harness register work. **Complete.** Every row is IMPLEMENTED with tests, verified-flipped, drafted-for-your-veto, or a registered finding. Commits `911b0594a → 17ba4fe17`, final blessed `16.0.1+fork.17ba4fe17b59` (digest 19db23cb…).

## The headline: fleet dogfood is CLOSED, live-proven
A cmux-hosted disposable-view canary (`019f66bf`, ws `fleet-canary-2d68`) was upgraded by the real rollout machinery — cordon → prepare-rollout → same-PID restart — landing on the new blessed with session identity preserved. That is the exact session class that froze for the previous owner. Two real bugs died on the way:
1. Freeze → typed bounded `TARGET_ERROR` receipts (phase/awaited/commandId/timeout/cause + build provenance); generic errors prohibited.
2. `Unknown control failure` → target fed the v2 prepare command into the pause action; runner's real rejection was swallowed by an empty-message tagged error. Fixed both layers; receipts now carry real bounded errors + journaled diagnostics.
A pre-fix canary in the same wave failed **bounded and reported, remaining sessions untouched** — the failure path works too.

## Landed overnight (each: focused tests + typecheck + staged checkpoint-gate)
| Row | Delivery |
|---|---|
| HR-130 | Child setup/run in bounded subprocess (typed JSONL protocol, SIGKILL process groups, RSS sampler, `task.isolateSetup`); extension AbortSignals with process-tree kill, reentrancy coalesce, output bounds, violation ring; loop-watchdog violation ring + `:loopstats`. **Spawn-wave proof: 30 admissions, key p99 8.7–21ms (<50), hung child non-blocking** |
| HR-121/127 | Headless tab budgets (session cap + reclaim, cross-process global cap via leases, typed top-consumer refusals), reuse-by-URL pool, idle TTL, `:tabs`; cmux/spawned/CDP exempt by contract |
| HR-129 s2 | `core.providers` deny postures with effective/expiry at projection time, admission-time exclusion with receipt provenance, CLI timing flags, multi-process proofs |
| HR-063 | Typed compaction receipts (trigger/tokens/retained/dropped-ranges/duration/model) in journal + `/compact` |
| HR-047 | Approved plans durable + `plan://latest`/`plan://<entry>`; open sub-item: diagnostic link to plan revision (row PARTIAL) |
| HR-035/040 | buildVersion+digest on ErrorInbox, error cards, fleet rows, TARGET_ERROR |
| HR-033 | `omp doctor` (+`--apply` safe subset: dead-peer prune, dead-PID lock clear) |
| HR-134 | `fleet status` RSS_MB/CPU%/UPTIME via one batched ps |
| HR-132 | Hub detail pane ROUTE section = `:route` provenance |
| HR-128 | 11-line living spawn guide auto-prepended (`task.spawnGuidePath`, mtime-cached) |
| HR-113 | Verified + flipped (already satisfied by landed code) |
| HR-126/136 | Flipped IMPLEMENTED at checkpoint (earlier session's fixes) |

## Waiting on YOU
1. **HR-125 veto**: `docs/fable/drafts/2026-07-16-control-plane-grammar.md` — key matrix + 3 taste questions + per-section cost; answer the checklist.
2. **HR-133 direction**: `docs/fable/drafts/2026-07-16-rss-paging-probe.md` — real measurements (idle runners 160–307MiB, WebKit Malloc dominant), 3 options, one recommended slice.
3. **Restart your TUIs** when convenient — but see HR-137: `/restart` reexecs the old binary blob (both canaries proved it). Until HR-137 lands, a *fresh* `omp` launch (or cmux pane respawn) is the reliable way onto `17ba4fe17`. Your working sessions were never touched.

## New findings (registered, unowned)
- **HR-137 (P1)**: `/restart` follows `process.execPath`, not the launcher symlink — promoted builds never reach live sessions via /restart.
- **HR-138 (P1/P2)**: idle peers drop from the fleet roster after ~40min, so idle-first rollouts lose their targets; rollout matching should consult the durable session index.
- Test-infra debt (unregistered, noted): running many coding-agent test files in one bun process cross-poisons via a leaked tool-execution spinner timer + theme-init race; per-batch runs are clean (184/0 proven). Worth a small fixture fix.
- Two prior-session bugs bit repeatedly and are worth watching: 120-request agent caps killing workers at the finish line (their work was salvaged from IRC evidence + tree each time), and parked-agent revive tool loss (HR-136 — fixed in source; live once sessions restart).

## Ledger
- Commits: `911b0594a`, `4b768fd44`, `9d194b021`, `a4341b428`(prior owner), `dc0a754e2`, `80f525be2`, `10f98df21`, `a729a3368`, `809de128c`, `2d684fca4`, `8261da2d2`, `17ba4fe17`.
- Live orchestration state: `docs/fable/handoffs/2026-07-16-overnight-harness-goal.md`.
- Old 668 canary (ws:22) left intact as the bootstrap-legacy specimen; orphaned test canary killed; no test peers on the real fleet store (verified clean twice).
