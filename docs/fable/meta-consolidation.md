# Meta-consolidation: one substrate, fewer primitives

2026-07-12, Fable. Answer to: "what overall infra makes everything easier/faster/higher quality; what meta-level issues should we fix; how do today's additions interact with existing primitives without duplicates that cause bugs?"

## The load-bearing insight from today

Every feature that shipped cleanly leaned on ONE primitive: the append-only session journal. Retention (parked agents reload from JSONL), the sibling cockpit (tail-follow), the HTML viewer (parse+project), transcript mining (filtered reads), crash recovery, replay — all journal consumers. Every bug cluster came from a SECOND copy of state that drifted from it: live AgentSession objects (5.9GB heap), job-handle registry vs agent registry (Not found), advisor lifecycle vs queue, view-owned scroll state vs committed history.

**Doctrine: the journal is the API. Everything else is a projection with a bounded cache.** New features must identify which projection they extend, never invent a parallel store.

## Duplicate inventory (today's additions vs existing primitives)

| Concern | Copies now | Mould into |
|---|---|---|
| Transcript rendering | TUI transcript-container, hub preview, sibling tail renderer, HTML viewer template, collab-web workstream | One journal-projection library (JSONL → typed entries) with per-surface render adapters. Parsing exists in ≥3 variants — the next parse divergence is a guaranteed bug. |
| Messaging | IRC in-process bus, bus-external (SQLite), collab v2 (encrypted), queue-v2 (durable input) | Keep queue-v2 as sole INPUT authority (settled). One DeliveryRecord schema (4b59fef1) spanning internal+external; `origin:user` (9d9782c2) should be a field of that schema, not an external-bus special case. Collab v2 = transport only, never a second message store. |
| Agent identity | registry id, job id, session id, external peer id, collab peer id | One AgentRef with facets. The job-handle-loss and dotted-id bugs were both identity-split bugs. |
| Ownership/identity metadata | owners-v1 lease, identity-v1 sidecar, RunnerInstance identity, collab session identity | Pattern settled (lease untouched + epoch-fenced sidecar) but readers are scattered — one reader module, everything (banner, sibling header, canary) imports it. |
| Naming | ambient renamer, hub display names, spawn labels, request-register titles | displayName + provenance (user|auto) on AgentRef; renamer writes only provenance=auto. Partially done (explicit-name metadata) — finish before a second namer appears. |
| Preview sources | hub subagent subscription, sibling tail-follow (seam: #renderTranscriptPreview) | Good example of moulding — the seam was cut deliberately. Template for future sources (workstream page should consume the same). |

## Meta-level fixes (ranked by iteration-speed × quality)

1. **Fix-omp-while-using-omp.** The revive bug bit ME six times today with its fix already committed — because your live coordinator can't restart. View reload is solved; the missing half is coordinator restart with subagent re-adoption (exit without killing children; owners-v1 + queue-v2 replay + cold-park make this feasible now). This is the single biggest unlock: until it lands, every fix waits a session-lifetime to matter. (Also your mined ask: "i want a way to exit/restart without killing the subagents".)
2. **Journal-projection library** (dedup row 1). Removes the five-renderer drift at the root; makes the next surface (multi-workstream web cockpit) cheap.
3. **Staged-snapshot gate as a script** (doctrine → `scripts/checkpoint-gate.sh`): detached-tree compile + focused tests + commit. Caught-class: 6d47bcbf. Promotion already runs it; checkpoints should too.
4. **Self-reporting friction daemon**: papercut tool → control-plane clustering → ranked queue. Replaces manual mining agents (one drowned today in a 17MB file; the pipeline shouldn't need heroics).
5. **Identity unification** (dedup row 3) — schedule as one slice before more control surfaces (web setModel, sibling input) multiply the id spaces.
6. **Runbook artifacts as the QA norm** (reload-runbook.json pattern): every feature ships a replayable runbook; proof-slices rerun them instead of reinventing.

## Interaction map for today's additions

- Cockpit preview/dual-lane/sibling view = projections over journal + SpawnRouteReceipt + DeliveryRecord — correctly read-only, no new stores.
- Ambient renamer writes ONLY displayName(provenance=auto) through the existing rename path — no new store.
- HTML viewer duplicates journal parsing (row 1) — first candidate for the projection library.
- Sibling origin:user input rides bus-external — fold its annotation into DeliveryRecord to avoid a second provenance concept.
- Registry previous-adoption (5f982ad1) closed the promotion loop: bless/rollback both executable.

## Traps

- Don't build the projection library as a big-bang rewrite; extract it when the NEXT consumer appears (multi-workstream page), migrating one renderer per slice.
- Don't unify identities by renaming everything at once; introduce AgentRef facets and migrate call sites behind the existing lookups.
- Coordinator restart must reuse the canary/readiness machinery, not a new lifecycle.

## Next decision (small)

Order the two big unlocks: (a) coordinator restart with re-adoption, then (b) journal-projection library — or reverse. Recommendation: (a) first; it makes every subsequent fix testable live, including (b).

## Primitive design bar (Arthur, 2026-07-12, verbatim intent)

"We want strong primitives, well designed, non-overlapping (orthogonal-ish; more orthogonal/composable is better)."

Acceptance test for any new primitive: (1) does an existing primitive already own this concern (extend, don't twin)? (2) can it be composed without knowing its consumers? (3) does deleting it leave exactly one hole? Overlap found later is a bug with a deletion deadline, not a coexistence plan.
