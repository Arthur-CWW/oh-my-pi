# HR-164 migration status (glanceable ledger — updated by the coordinator at every wave gate)

Plan: [`docs/fable/drafts/2026-07-16-effect-migration-execution-plan.md`](../../../docs/fable/drafts/2026-07-16-effect-migration-execution-plan.md) · Brief: [`…-effect-otp-supervision-brief.md`](../../../docs/fable/drafts/2026-07-16-effect-otp-supervision-brief.md) · Divergence ledger: [`DIVERGENCES.md`](DIVERGENCES.md)

## Phase 0 — mapping + test excellence (ACTIVE, started 2026-07-16)

| Artifact | Owner | State | Proof |
|---|---|---|---|
| H1 contract (`CONTRACTS/h1-child-lifecycle.md`) | Fable | DRAFT — awaiting Arthur approval | — |
| `EFFECT-PORTING.md` + probe extensions | PortingGuide2 worker | DONE 2026-07-16 | 9 pattern rows each citing a green probe; probes 5→14 (28 expects); beta.92 delta documented (no Schedule.upTo → modifyDelay+recurs) |
| H1 executable model + DST driver (`test/migration/`) | H1ModelDst worker | DONE 2026-07-16 | 300 seeds × 4 fault profiles = 1,200 runs/36ms, contract self-consistent (I1–I9 zero violations), drop-one shrinking, `OMP_DST_SEED` repro |
| H1 seam suite (deterministic edges) | H1SeamSuite worker | DONE 2026-07-16 | 11 pass + 2 todo(D2/D3) across I1/I2/I4/I7/I8/I9 + Settings/IRC-refusal regression guards |
| Trace conformance checker (journal → model) | TraceConformance worker | DONE 2026-07-16 | real-child journal fixture clean, I1/I2 violation fixtures detected, `OMP_CONFORMANCE_JOURNAL` opt-in replay |
| H2 evidence table (park/revive/bus races) | H2EvidenceScout worker | DONE 2026-07-16 | `notes/h2-evidence.md`: 19 changelog rows, 6 bus + 6 lifecycle sites, 10 candidate invariants |
| H2 contract (`CONTRACTS/h2-mailbox-park-revive.md`) | H2ContractDraft2 worker (Sol) | DRAFT — awaiting Arthur read (hard gate for the H2 port) | 14 evidence-cited invariants (all 10 candidates kept/merged, 0 dropped); 15-row DST fault matrix; 6 divergence seeds; frozen generic `h2-model` interface with compile-time `H2Envelope<H1Event>` co-design assertion; 9 open policy questions listed in-document |
| H1 inventories (`inventories/h1/*.tsv` + SINGLETONS.md) | 5 kimi scouts + 2 Luna adversarial reviewers | SCOUTED 2026-07-17, review in flight | ERRORS 141 rows / CANCELLATION 69 / RESOURCES 50 / CONCURRENCY 61 + 41 singletons / TIME 85; all TSVs parse with consistent columns; top finding: `executor.ts:1933-1940` wall-clock timeout converts a successful yield into failure (the I2 canonical violation, live in code) |

## Gates passed

| Date | Gate | Result |
|---|---|---|
| 2026-07-16 | Phase 0 wave 1 union (dst + conformance + seam) | 16 pass/1 skip/2 todo/0 fail, 1,246 expects, check:types clean |
| 2026-07-16 | HR-163 precondition (durable yield recovery) | blessed `468ef51ae3c1` |

## Next

1. Arthur approves/edits H1 contract → trial loop (1–3 files) → H1 port wave (hard-gated on his approval).
2. Arthur reads H2 contract draft → rulings on its 9 open questions → H2 port wave (hard-gated).
3. Adversarial inventory review lands → inventories committed as port-wave planning input.
