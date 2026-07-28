# Validation charter

> **Provenance — 2026-07-28.** Landed from `review/validation-charter` (`docs/learning/validation-charter.md`), authored by Arthur's harness lane on 2026-07-27. Its four stacked predecessor artifacts—testing strategy, rollout patterns, reliability plan, and execution profile—were not copied. They remain linked authorities or were landed separately.

Status: living document—update as practices are proven or falsified
Owner: harness stream; applies to every app in this monorepo

## Why this exists

Arthur's end goal (2026-07-27, tier A): *the procedures, practices, and infrastructure to make better software faster*—better tooling to validate, explore, compose, and bench. OMP is the first customer, not the purpose. Every practice here should transfer to the next app (companion, primer, playground) or it does not belong here.

This file is the index and ontology. It links; it does not restate. Detailed strategy lives in [`docs/learning/omp-testing-strategy.md`](../learning/omp-testing-strategy.md), rollout mechanics in [`docs/learning/kubernetes-rollout-patterns.md`](../learning/kubernetes-rollout-patterns.md), and program sequencing in [`harness-reliability-program.md`](harness-reliability-program.md). Source synthesis lives in [`docs/research/testing-talks/`](../research/testing-talks/) and [`docs/research/dst-hegel-bombadil-verdict.md`](../research/dst-hegel-bombadil-verdict.md).

## Ontology

Five things get confused unless named. Keep them distinct:

1. **Boundary** — where controlled inputs replace the world: Effect layers at provider/clock/network seams, or the VM wall for OS faults. Test honesty is determined by boundary placement.
2. **Cell** — an isolated execution world with explicit resources and lifecycle: test process → bounded service scope → NixOS VM. Cells may nest; each names its ceiling.
3. **Oracle** — what decides pass/fail. Ranked by strength: invariant > property > differential > golden/snapshot > human taste. A snapshot supplements invariants; it never replaces them.
4. **Fault** — a controlled injection such as process kill, ENOSPC, partition, clock change, WAL contention, or PID reuse. A fault the runner cannot verify was applied is a failed run, not a pass.
5. **Receipt** — durable evidence tying commit, environment digest, seed, `RunId`, and per-invariant results. No receipt, no claim. Testimony is not proof.

## Philosophy

- **Restructure for testability instead of mocking.** Pure decision core; effects at edges; state machines accept decoded values and return actions.
- **The harness must be able to fail.** Every substantial suite carries a negative control: revert the behavior or inject the violation and observe the exact focused failure.
- **Conservative degradation is an invariant, not a style.** Sampling failure over-charges; missing telemetry fails the run; unprovable identity contributes no authority.
- **Identity is a full tuple, never a partial key.** PID, path, or hostname alone is an observation, not identity. Test the tuple.
- **NixOS pins the environment; it does not create determinism.** Barriers, seeds, injected clocks, and identity fencing remain necessary. VM ≠ deterministic simulation.
- **Real state, controlled entropy.** Never mock OMP-owned journals, SQLite, or processes. Replace provider sampling, clocks, and unsafe external effects through explicit Live/Recording/Replay/Scripted/Rejecting boundaries.
- **Schema at boundaries.** Decode process, provider, file, RPC, and SQLite values before they enter decision code.

The source-backed rationale and current tool verdicts are maintained in the linked testing research. In particular, do not preserve old claims about Hegel's Python requirements or treat UI trace replay as whole-runtime determinism.

## The cell ladder

| Rung | Cell | Oracle | Catches |
|---|---|---|---|
| 1 | Pure function, focused test process | Property/invariant | Logic, parsing, thresholds |
| 2 | State machine + generated commands | Model-based + projection snapshots | Lifecycle, ownership, ordering |
| 3 | Real processes, bounded service scope | Invariants + receipts | IPC, SQLite contention, RSS, FIFO |
| 4 | NixOS VM/fault cell | Invariants + fault verification | Process death, ENOSPC, partitions, DST |
| 5 | Differential blessed vs candidate | Equivalence on canonical projections | Unpredicted regressions |
| 6 | Credential-gated live canary | Contract only | Provider drift |

Fuzzing enters at rungs 2 and 4 once a model exists: fuzz command sequences, not bytes. Property/UI tools graduate only through focused pilots against existing suites; adoption decisions live in the grounded verdict, not this charter.

## Cell-selection rule

Start at the lowest rung that crosses the boundary capable of producing the defect:

- Pure decoding and threshold mistakes stay at rung 1.
- Ordering, lifecycle, and ownership mistakes require the state-machine rung.
- OS process, storage, network, or time behavior requires the corresponding real boundary.
- Provider parsing and routing use replay first; a live canary proves only the provider wire contract.
- Integration claims require an integration cell; a focused unit test cannot be relabelled as one.

Use a higher rung only when the lower rung cannot observe the behavior. Expensive realism without a stronger oracle is not stronger proof.

## Receipt minimum

A behavioral receipt records:

- Git and build identity;
- cell and environment identity;
- `RunId`, scenario version, and seed;
- controlled inputs and relevant digests;
- the fault requested and evidence it was applied;
- every invariant and its result;
- artifact hashes and locations;
- the exact focused rerun command.

If any required field is unavailable, say so in the receipt and narrow the claim. Never infer a pass from absent evidence.

## Practices

- **One behavior per change per PR.** Historical stacked branches are mined, never merged wholesale.
- **Validation first.** A change lands only after the test cell defining its contract exists and passes; validation infrastructure precedes the backlog it validates.
- **Hermetic state.** Isolate every OMP-owned config, session-control, IRC, journal, and database root inside the cell. HOME alone is not isolation.
- **Durable receipts.** Include rerun commands, exact environment identity, results, and artifacts; promote a receipt into durable docs only when it changes a decision.
- **Resume and salvage before respawn.** Recover the agent's durable journal/change first; work can outlive the current process.
- **Adversarial review before merge.** Self-reported green is testimony, not independent evidence.
- **Reversibility rule** (Arthur, 2026-07-27, tier A): no irreversible infrastructure change without a rollback path. Live state roots, credentials, and canonical refs require an explicit rollback receipt.
- **Explicit routing intent.** Every delegated spawn declares model and effort rather than silently inheriting them.
- **No silent scope shrink.** A narrowed test may prove its cell; it cannot be presented as integration or system proof.

## Direction

1. Extend seeded state-machine validation for session, ownership, admission, and delivery semantics.
2. Keep differential replay of historical journals as a first-class regression oracle.
3. Add controlled fault schedules around those models in disposable cells.
4. Port the ladder to primer, then companion, without copying OMP-specific machinery into their domain cores.
5. Add queryable run observability only after manifests and questions stabilize; see [`docs/state/deferred-harness-ideas.md`](../state/deferred-harness-ideas.md).

## Durable observations, not mandates

- Goal context must never outrank a new user turn. This is an invariant for turn construction, not a reason to special-case models.
- Live route/effort controls must preserve in-flight work and report the transition honestly.
- Lost-work prevention is a lifecycle and durable-recovery concern; do not band-aid it with duplicate agents.
- Missing telemetry, an unapplied fault, or an unverified review surface is a failed proof—not a degraded pass.
