# Fable sync surface — read this to sync with the orchestrator

Rewritten 2026-07-13. Owner: the acting Fable-lane orchestrator; reconcile in place, never append contradictions.

**What this doc is now.** Arthur reads this one file to sync with the current orchestrator: stance, critique, doctrine, open forks. It is NOT a system map and NOT a status ledger:

- Mechanical map (layers, primitives, invariants, known-open bugs): [`omp-primitives-map.md`](omp-primitives-map.md) — authoritative.
- Work intent/status: [`harness-request-register.md`](harness-request-register.md) HR rows. Papercuts: [`../state/harness-friction.md`](../state/harness-friction.md). Frequency/ranking: [`../state/harness-issue-taxonomy.md`](../state/harness-issue-taxonomy.md).
- This file's previous content (lifecycle truth table, telemetry gap analysis, staged A–E plan) is in git history; parts were stale (it claimed restart child re-adoption was unimplemented — it shipped and is blessed).

## Stance, 2026-07-13

Arthur redirected from the inherited stabilization program to meta-level quality — unslop the repo, fix the generators of slop, keep evidence surfaces honest — then layered on the shared-workspace/rendering direction (see [`shared-workspace-brief.md`](shared-workspace-brief.md), four voice rants extracted) and data feeds (generic feed registry; full-account Twitter sync).

Landed this session, union-gated (113/113 coding-agent + 5/5 tui + 3/3 ratchets, types clean):
- **Hygiene:** durable-doc rescue (146 triaged, 61 rescued w/ checksum manifest); 2.17GB reclaimed (4,469 session logs zstd'd, proof archives verified); TASKS.md 102KB→7.3KB + friction Fixed sharded; three ratchet lints live (`lint:ratchets`: size-freeze incl. agent-hub@3397, root-litter, twin-parser).
- **Memory (30GB redesign):** `task.maxLiveChildren` admission cap (default-0 no-op; bench peak 4/12); segment-local transcript dirtiness (2,002→1 prefix scans, independent review: approve/0 findings); RSS watermark status segment. Known gap: revivals bypass the cap (friction row; fix in flight).
- **Evidence:** taxonomy refreshed through 07-13 (top classes: cancelled-children output loss 25×, delegated tool-protocol corruption); quota-staleness lesson institutionalized in `model-availability.md` (Tibo hard-reset 07-12; check @thsottiaux before rerouting); lane-strength criterion (entropy × blast radius × legibility) added to routing doctrine; AGENTS.md routing drift reconciled.
- **Shipped late-wave (all union-gated in-tree, uncommitted):** Agent Hub tok/s LIVE-PROVEN (36.8/21.4 tok/s captures; false isStreaming gate removed) + modal grammar (`/` search fixed, normal-mode default, `v` rich/plain, exhaustive `?`); paste-pill Enter-to-expand + repaired main-status tok/s; revive-through-admission (5s bounded wait, wedge-proof); generic feed registry (`packages/availability-watcher`, feeds.yml, live-validated on the 07-12 reset) + `/feeds` + `feed://` fork surface; nested spawn-tree roster with `agent-hub-roster.ts` extraction (god-file 3456→3387); full-account Twitter sync (thsottiaux 591, pleometric 655+163 media, per-lane exhaustion recorded). Ratchets re-baselined once, dated, at wave end. Queued on Arthur's go: automations primitive, cmux tab-renamer probe, life-queue v0, refund one-shot (Sol, context-isolated) — see [`automations-life-queue-brief.md`](automations-life-queue-brief.md).

## What the orchestrator doesn't like (critique, evidence attached)

1. **`agent-hub.ts` is a 3,373-line god-object.** Roster, filters, dual-lane layout, inspector, transcript cache+parse+sync, live subscriptions, editor, IRC delivery projection, route provenance, external peers — one class, ~60 mutable private fields. It violates the fork's own doctrine (journal is the API; views are bounded projections). The journal-projection library exists (`1b6c8124`); the Hub preview should become its consumer, and the file must shrink on every touch, never grow.
2. **The 30GB subagent footprint is not a leak — it's JSC page high-water retention.** `rescued/subagent-memory-profile.md` (2026-07-13): cold-park verifiably releases children (39.9× heap-slope drop, 297/300 WeakRefs collected), but RSS is set by *peak* simultaneous live sessions × materialized transcripts and never returns to the OS (352KB post-GC heap vs 212MB RSS from preview churn at N=300). Open fixes, in leverage order: live-children admission cap; segment-local transcript dirtiness (stop re-scanning finalized history per animation frame); bounded-tail preview parsing without full-text intermediates. Operational mitigation that already works: cheap `/restart` (re-adoption is proven, round6).
3. **Routing-doctrine drift between authorities.** Root `AGENTS.md` (2026-07-03) caches "Sol medium is the default implementer"; `agent-stack-consolidation.md` (2026-07-12, newer, checkpointed) says Luna xhigh is the default bounded implementer with Sol as escalation. A cached lane in a higher layer silently contradicts newer doctrine. Fix: AGENTS.md points at the doctrine instead of caching lane names.
4. **The prompt stack is instance #1 of the core context disease.** Inline tool reference manuals (task ~9KB, read ~4KB), the grep/cat prohibition restated three times, 33 skills advertised vs 15 intended, per-message delegation reminders, workers inheriting orchestrator-shaped contract text. Evidence to cut against exists (`tool-usage-analytics.md`). Audit parked by Arthur ("skip B for now") — do not restart it without him.
5. **Uncommitted liability.** ~1,200 unstaged / ~950 untracked paths; an unverified cmux nine-finding slice; a subagent worker-pool *echo stub* that misrepresents itself as a worker pool. Verification had to invent staged-snapshot gates to route around the dirty tree — that is a symptom, not a solution.
6. **Ledgers themselves are slopping.** TASKS.md 102KB (Done-dominated), friction ledger's Fixed section ~90 rows, request register 61KB. Append-heavy despite the "reconcile, don't append" doctrine. Live docs should stay one screen; history shards by date.

## Slop doctrine: ratchet, not sweep

A one-time cleanup regresses in a week. Every cleanup must land with the guardrail that prevents recurrence, at the cheapest layer (lint > gate check > prompt text). Template: `lint:unsafe-types`. Planned ratchets, in order:

| Ratchet | Catches | Status |
|---|---|---|
| File-size ratchet (baseline JSON; offenders frozen, may shrink never grow; new files ~800-line cap) | the next agent-hub.ts | proposed |
| No-new-root-files / untracked-litter gate check | the `fix.js` class | proposed |
| Twin-parser ast-grep ban (session-JSONL parsing outside `src/journal/`) | dedup regressions | proposed |
| Proof retention GC (`scripts/sessions-gc.ts` + deslop retention contract) | `local/` sprawl, log growth | landed 2026-07-13 |
| Packet leave-cleaner clause (delete what you supersede, in-slice; gate enforces) | worker residue | proposed |
| Ledger sharding (Done/Fixed rows → dated history files) | ledger bloat | proposed |

## Artifact placement doctrine

`local://` is **session-scoped** (`~/.omp/agent/sessions/<id>/local/`) — subagents of the same session see it; future sessions do not. 103 durable md docs were stranded there before today's rescue.

| Artifact | Home |
|---|---|
| Intra-session scratch, subagent payloads | `local://` — the only legitimate use |
| Handoffs | `docs/fable/handoffs/<date>-<name>.md` |
| Contracts, architecture notes, fork plans, analyses | `docs/fable/` (or stream docs) — git-visible, never gitignored `local/` root |
| Proof artifacts | `local/proofs/<feature>/` under the deslop retention contract (accepted run + `latest.json`; superseded runs archived compressed) |
| Copied binaries | never — digest + promotion receipt + reproducible build command |
| Personal/support evidence (screenshots, appeals) | private store, separate retention; never mechanically archived with engineering proofs |

## Open forks awaiting Arthur

1. Delete the subagent worker-pool echo stub (recommended: yes — regenerable, and its only future is being mistaken for the feature)?
2. Delete root `fix.js` (recommended: yes, after confirming its three edits exist in fork history)?
3. Personal screenshots at `local/` root → private store?
4. TASKS.md stays authoritative vs control-plane ledger?
5. `local/voiceink-store-backup-20260713` (8.3GB — 85% of the repo's disk problem): keep, move to external archive, or delete after verifying VoiceInk health?
6. Re-verify or reject the uncommitted cmux nine-finding slice?
7. ~~Agent Hub tok/s slice timing~~ — done and live-proven 2026-07-13 (36.8/21.4 tok/s captures, editor-free preview).
8. Checkpoint/commit posture for today's union-gated slices (9 fork slices + hygiene, all in-tree uncommitted on the dirty tree): staged-snapshot checkpoints now, or after your review?

## Pointers

Charter/identity: [`charter.md`](charter.md) · priors: [`priors.md`](priors.md) · map: [`omp-primitives-map.md`](omp-primitives-map.md) · consolidation doctrine: [`meta-consolidation.md`](meta-consolidation.md), [`agent-stack-consolidation.md`](agent-stack-consolidation.md) · deslop audit + executed cleanups: [`../state/deslop-plan.md`](../state/deslop-plan.md) · rescued docs: [`rescued/MANIFEST.md`](rescued/MANIFEST.md)
