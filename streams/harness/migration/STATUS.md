# HR-164 migration status (glanceable ledger — updated by the coordinator at every wave gate)

Plan: [`docs/fable/drafts/2026-07-16-effect-migration-execution-plan.md`](../../../docs/fable/drafts/2026-07-16-effect-migration-execution-plan.md) · Brief: [`…-effect-otp-supervision-brief.md`](../../../docs/fable/drafts/2026-07-16-effect-otp-supervision-brief.md) · Divergence ledger: [`DIVERGENCES.md`](DIVERGENCES.md)

## Phase 0 — mapping + test excellence (ACTIVE, started 2026-07-16)

| Artifact | Owner | State | Proof |
|---|---|---|---|
| H1 contract (`CONTRACTS/h1-child-lifecycle.md`) | Fable | DRAFT — awaiting Arthur approval | — |
| `EFFECT-PORTING.md` + probe extensions | PortingGuide worker | IN FLIGHT | probe suite green |
| H1 executable model + DST driver (`test/migration/`) | H1ModelDst worker | IN FLIGHT | seeded schedules × fault matrix, violations reproduce by seed |
| H1 seam suite (deterministic edges) | H1SeamSuite worker | IN FLIGHT | extends `test/task/subprocess-worker-reliability.test.ts` |
| Trace conformance checker (journal → model) | TraceConformance worker | IN FLIGHT | real HR-163 journals replay clean or produce DIVERGENCES rows |
| H2 evidence table (park/revive/bus races) | H2EvidenceScout worker | IN FLIGHT | read-only inventory for the H2 contract pass |

## Gates passed

| Date | Gate | Result |
|---|---|---|
| 2026-07-16 | HR-163 precondition (durable yield recovery) | blessed `468ef51ae3c1` |

## Next

1. Arthur approves/edits H1 contract → scouts' inventories (ERRORS/CANCELLATION/RESOURCES/CONCURRENCY/TIME) fan out.
2. Trial loop (1–3 files) → H1 port wave.
