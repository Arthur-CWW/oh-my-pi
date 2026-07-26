# HR-164 migration status (glanceable ledger — updated by the coordinator at every wave gate)

Plan: [`docs/fable/drafts/2026-07-16-effect-migration-execution-plan.md`](../../../docs/fable/drafts/2026-07-16-effect-migration-execution-plan.md) · Brief: [`…-effect-otp-supervision-brief.md`](../../../docs/fable/drafts/2026-07-16-effect-otp-supervision-brief.md) · Divergence ledger: [`DIVERGENCES.md`](DIVERGENCES.md)

## Phase 0 — mapping + test excellence (ACTIVE, started 2026-07-16)

| Artifact | Owner | State | Proof |
|---|---|---|---|
| H1 contract (`CONTRACTS/h1-child-lifecycle.md`) | Fable | DRAFT — awaiting Arthur approval | — |
| `EFFECT-PORTING.md` + probe extensions | PortingGuide2 worker | DONE 2026-07-16 | 9 pattern rows each citing a green probe; probes 5→14 (28 expects); beta.92 delta documented (no Schedule.upTo → modifyDelay+recurs) |
| H1 executable model + DST driver (`test/migration/`) | H1ModelDst worker | DONE 2026-07-16 | 300 seeds × 4 fault profiles = 1,200 runs/36ms, contract self-consistent (I1–I9 zero violations), drop-one shrinking, `OMP_DST_SEED` repro |
| H1 reliability seam suite (D1–D3) | JournalDelivery workers | LANDED 2026-07-26 | Change `pnpzrmzt` (`harness-journal-delivery`): 27/27 `test/task/subprocess-worker-reliability.test.ts`; D1 delivery-at-yield, D2 timeout ordering, and D3 journal-terminal job projection are all test-pinned |
| Trace conformance checker (journal → model) | TraceConformance worker | DONE 2026-07-16 | real-child journal fixture clean, I1/I2 violation fixtures detected, `OMP_CONFORMANCE_JOURNAL` opt-in replay |
| H2 evidence table (park/revive/bus races) | H2EvidenceScout worker | DONE 2026-07-16 | `notes/h2-evidence.md`: 19 changelog rows, 6 bus + 6 lifecycle sites, 10 candidate invariants |
| H2 contract (`CONTRACTS/h2-mailbox-park-revive.md`) | H2ContractDraft2 worker (Sol) | DRAFT — awaiting Arthur read (hard gate for the H2 port) | 14 evidence-cited invariants (all 10 candidates kept/merged, 0 dropped); 15-row DST fault matrix; 6 divergence seeds; frozen generic `h2-model` interface with compile-time `H2Envelope<H1Event>` co-design assertion; 9 open policy questions listed in-document |
| H1 inventories (`inventories/h1/*.tsv` + SINGLETONS.md + review/) | 5 kimi scouts + 2 Luna adversarial reviewers + 1 Luna fixer | DONE 2026-07-17 — HISTORICAL FINDINGS RETAINED | Post-review counts remain provenance: ERRORS 146 / CANCELLATION 69 / RESOURCES 54 / CONCURRENCY 61 + 41 singletons / TIME 86. The former `monitor.finish()` headliner was resolved in change `c3a4e5807` with `test/task/executor-wall-clock.test.ts`; D1–D3 were resolved in `pnpzrmzt` (`harness-journal-delivery`) with 27/27 reliability tests. Inventory wording is dated archaeology, not an open-defect projection. |
| H1 trial loop (3-file port, branch `hr164-h1-trial`) | Luna implementer → Sol finisher → Opus+Luna adversarial reviewers → Sol fixer | SUPERSEDED-AS-EVIDENCE 2026-07-26 | Branch commit `510fae778` and `notes/h1-trial-report.md` retain the 68-row inventory/review lessons; current runtime authority is the narrower change `pnpzrmzt` (`harness-journal-delivery`, 27/27 reliability tests). Keep `local/hr164-trial`; do not merge or project its Effect/v2 protocol as live state. |

## Gates passed

| Date | Gate | Result |
|---|---|---|
| 2026-07-16 | Phase 0 wave 1 union (dst + conformance + seam) | 16 pass/1 skip/2 todo/0 fail, 1,246 expects, check:types clean |
| 2026-07-16 | HR-163 precondition (durable yield recovery) | blessed `468ef51ae3c1` |
| 2026-07-26 | H1 D1–D3 runtime landing | change `pnpzrmzt` / bookmark `harness-journal-delivery`; 27/27 `test/task/subprocess-worker-reliability.test.ts` |

## Next

1. Treat change `pnpzrmzt` (`harness-journal-delivery`) and its 27/27 reliability suite as the runtime authority for H1 D1–D3.
2. Retain `hr164-h1-trial`/`510fae778`, `local/hr164-trial`, and `notes/h1-trial-report.md` only as superseded design/review evidence.
3. H2 remains independently approval-gated by `CONTRACTS/h2-mailbox-park-revive.md`; the H1 landing does not claim H2 completion.
