# HR-164 execution plan v2: hotspot-scoped Effect migration with contract-first redesign

Provenance: Arthur, 2026-07-16 — three directives, in order: (1) "rewrite all the tricky concurrency, lifecycles, scope, cleanup with effect … massively parallel with no regressions … bun blog post as reference … sol orchestrator / luna/opus implementer / kimi"; (2) "not just lifecycles … think from effect primitives how they map over … higher level concurrency behavior before hand is wrong in some of the cases … intention is not just 1-1 port but to fix some of the deeper issues"; (3) "focus on the most important parts to migrate / most complicated and error prone and do those and improve the test there".
Companion to the design brief (`2026-07-16-effect-otp-supervision-brief.md`). Reference methodology archived: `docs/research/bun-rust-migration/cleaned/bun-in-rust.md`. Supersedes v1 of this file (organ-complete waves) — v1's loop mechanics survive; its scope does not.

## The two deltas from Bun's situation — and what they force

1. **Bun's behavior was correct; ours partially isn't.** Their test suite was ground truth, so a faithful 1-1 port gated by parity was sound. Parts of our concurrency behavior are wrong by design (silence-ambiguous children, report-on-exit, singleton fallbacks, revive races, abort re-entrancy). A pure parity gate would freeze those bugs in. Therefore: **contract-first for broken protocols, parity for everything else**, with an explicit divergence ledger separating the two.
2. **Lifetimes were Rust's load-bearing discipline; Effect has five.** Bun inventoried LIFETIMES.tsv because that's what the borrow checker adjudicates. The Effect-primitive inventory set (below) is the analog — each primitive is a lens that extracts a different class of latent bug from the same code.

## Scope: evidence-ranked hotspots, not organs

Selection criterion: incident density (register rows, changelog Fixed entries, protected-region markers, this session's failure cluster). Migrate + redesign + **improve the tests at that seam** — nothing else moves.

| # | Hotspot | Evidence of pain | Contract to formalize first |
|---|---|---|---|
| H1 | **Spawn/worker lifecycle + report delivery** (`task/executor.ts` park/dispose ordering, `spawn-worker-client.ts`, `spawn-worker-entry.ts`) | Today's entire cluster (HR-163: 4 hostage yields, 1 yield→SpawnWorkerError, dead child IRC, dead `edit`); death modes 1–3 "routine"; HR-163 patched the symptoms — the state machine is still implicit | **Child lifecycle state machine**: spawn → running → (yield \| crash \| timeout \| interrupt) → park → (revive \| reap), with report delivery an event of *yield*, never of exit; every transition observable (journal record + monitor message) |
| H2 | **Park/revive + bus delivery races** (`irc/bus.ts`, lifecycle registry, revive path) | Changelog: "reserve parked-agent messages before revival", "replacement identities across revive races", "released or replaced while reviving"; revived agents losing tool inventories; subprocess loopback (HR-163) | **Mailbox contract**: delivery/reservation/revival as a serialized state machine (GenServer-shape); a message to a parked agent has exactly-once semantics across revival, defined ordering, and a typed dead-letter outcome |
| H3 | **Durable-input/abort core** (`agent-session.ts` protected ranges ~2691–2727, 6086–6104, 7040–7440, 8249–8290) | The depth-counted abort gate is hand-rolled structured concurrency; changelog: Ctrl-Q/abort race "permanently wedged durable follow-up delivery"; marked "surgical, sign-off required" — the single most complicated + error-prone region in the codebase | **Admission/abort protocol**: interruption regions with guaranteed finalizers; which sections are uninterruptible (journal flush, queue drain); re-entrant abort defined as idempotent by construction, not by counter |

H1 → H2 → H3 strictly ordered: each raises confidence + test infrastructure for the next; H3 (protected) goes last, under the existing sign-off ritual, only after H1/H2 soak. Anything outside these seams is out of scope until a hotspot earns its way onto the table with evidence.

## Prep artifacts, primitive-mapped (the LIFETIMES.tsv analog, plural — scoped per hotspot)

Generated per hotspot by scout workflows + 2 adversarial reviewers, read end-to-end by Fable/Sol; each is a lens over the SAME code:

| Effect primitive (lens) | Artifact | Row shape |
|---|---|---|
| Error channel (typed failure vs defect vs interruption) | `ERRORS.tsv` | every throw/reject/catch/swallow site → expected-or-defect, owner, current swallow hazard, target `Schema.TaggedErrorClass` |
| Interruption | `CANCELLATION.tsv` | every AbortSignal/timeout/kill path → cleanup guarantee, double-fire hazard, interruptible vs uninterruptible region |
| Scope/acquireRelease | `RESOURCES.tsv` | acquire/release pairs (procs, ptys, sockets, DB handles, locks, temp dirs) → current mechanism, ordering constraints, leak history |
| Fiber/Queue/Deferred (topology) | `CONCURRENCY.tsv` | mutable state owner, must-serialize operations, backpressure points, races currently "handled" by sleeps/retries |
| Schedule/Clock | `TIME.tsv` | every setTimeout/Date.now/retry/TTL → target Schedule policy, TestClock determinism plan |
| Layer/Context | (in brief) singleton burn-down list | `.global()`/`getInstance()` callsites in the hotspot |

Plus, per hotspot, the two documents that encode "not a 1-1 port":

- **`CONTRACTS/<hotspot>.md`** — the *intended* protocol as an explicit state machine (states, transitions, events, invariants), written and Arthur/Fable-approved BEFORE porting. This is the OTP move: design the gen_server/supervision protocol first, then implement it.
- **`DIVERGENCES.md`** — append-only ledger: every place new behavior ≠ old behavior, each row citing its contract clause. **Finite and small by intent** — if a hotspot's ledger sprawls, the redesign is under-specified; stop and fix the contract. Everything NOT in the ledger must match old behavior exactly.

"No regressions" then means: **parity suite green on all un-ledgered behavior + contract suite green on all ledgered behavior.** Regression = un-ledgered deviation. This keeps the Bun-grade gate meaningful while still fixing the deeper issues.

## Test improvement is a deliverable, not a gate-chore

Per hotspot, before its port wave: a behavioral suite at the seam (observable contracts: journal records, receipts, tool results, pipe protocol — never internals), covering the contract state machine's transitions *including the failure/interrupt edges that today's tests skip*. HR-163's `subprocess-worker-reliability.test.ts` is the seed for H1. These suites outlive the migration — they are the permanent invariant Bun already had and we didn't.

## Pre-named regression classes (reviewer reject-list, unchanged from v1)

1. **Eagerness**: an un-run Effect silently never executes (dual of Bun's erased `debug_assert!` side effect) — lint for dropped effects.
2. **Interruption ≠ AbortSignal** timing; code assuming synchronous abort handlers.
3. **Finalizer ordering**: try/finally nesting vs Scope LIFO (journal flush before pipe close).
4. **Microtask reordering** at TUI seams (TUI itself stays out of Effect).
5. **Error-channel splits**: catches that used to swallow everything now see only defects.
6. Bun's comment rule, verbatim: a paragraph-long justification for a workaround ⇒ the code is wrong.

## The loop (per hotspot, unchanged mechanics from v1 / Bun)

1. Scouts produce the six inventories; contract drafted; adversarial review of both; Arthur reads the CONTRACT (the taste gate).
2. Seam test suite written + green (parity portions against `main` unchanged; contract portions red-until-ported where behavior diverges).
3. Trial run: 1–3 files through the full loop (1 implementer + 2 adversarial reviewers, ≥1 from a different model family + 1 fixer) before fan-out.
4. Fan-out sharded by module, one owner per file; workers never run project gates or destructive git; prompts live in `streams/harness/migration/loops/*.md` — failure classes fix the prompt, never hand-patch output.
5. Gate: typecheck queue → seam suite (parity + contract) → staged-snapshot checkpoint → coordinator commits; cutover deletes the replaced path.
6. Bless ≠ adopt: canary soak (this session's own children as load) before fleet rollout.

## Lane mix (unchanged)

Fable/Sol: orchestration, contracts, taste gates, prompt edits, integration commits. Luna xhigh + Opus: implementers/fixers. Kimi: scout volume + adversarial reviewer swarm (≥1 reviewer per packet from a non-implementer family). Lanes resolve live from `.omp/*.yml` at spawn time.

## Preconditions

1. HR-163 blessed binary adopted by the coordinating session (the waves run ON these organs) — done 2026-07-16 (`468ef51ae3c1`), adopt via fresh `omp`.
2. H1 contract approved by Arthur before any H1 port packet spawns.
3. Worktree/disk janitor in place (Bun's IOPS lesson).

## Success criteria

- Per hotspot: seam suite 100% green (parity + contract), zero tests skipped/deleted; divergence ledger complete and small; death modes/races named in the contract have failing-before/passing-after tests.
- Cutovers leave no dual paths or shims; replaced code deleted in the same wave.
- Post-bless regression ledger (Bun shipped 19, fixed all — honest budget, not zero-fantasy); every regression adds a seam test.
- Rework leaderboard per lane recorded — feeds routing doctrine.
