# H1 port loop — implementer prompt (v1, trial)

Parameterized by: `{FILES}` (1–3 file paths under `src/task/`), `{WORKTREE}` (absolute repo root the port happens in).

## Authority chain (read in this order, all inside {WORKTREE})

1. `streams/harness/migration/CONTRACTS/h1-child-lifecycle.md` — the contract is LAW. Every behavior you produce is either (a) old behavior exactly, or (b) a `DIVERGENCES.md` row citing a contract clause. Nothing else.
2. `streams/harness/migration/inventories/h1/*.tsv` — filter to rows whose `site` is in {FILES}. EVERY row must be addressed in the port:
   - ERRORS row → the site's failure flows through the row's `target_tagged_error` (`Schema.TaggedErrorClass`), in the typed error channel if expected, the defect channel if defect. No swallow marked `swallow_hazard=yes` survives.
   - CANCELLATION row → the path becomes Effect interruption; the row's `interruptible_region` verdict is honored (`Effect.uninterruptibleMask` for journal-flush/yield-write class regions); double-fire hazards become idempotent by construction.
   - RESOURCES row → the resource is acquired via `Scope`/`acquireRelease` under the row's `owning_scope_proposal`; multiple release paths collapse to the Scope finalizer; ordering constraints (journal flush BEFORE pipe close) are finalizer order.
   - CONCURRENCY row → the row's `target_primitive` replaces the hand-rolled mechanism (replace, NEVER wrap — a wrapper exists only to encode a domain contract like exactly-once-across-revival).
   - TIME row → the timer becomes the row's `target_schedule`; timers that can fire on a yielded/parked child are disarmed at `yieldWritten` (contract I3). beta.92: no `Schedule.upTo` — use `modifyDelay`+`recurs` per `EFFECT-PORTING.md`.
3. `streams/harness/migration/EFFECT-PORTING.md` — known correspondences + probes. Extend it if you find a new correspondence (append, cite your probe).
4. `test/migration/model/h1-model.ts` + the DST driver + seam suite (`test/task/subprocess-worker-reliability.test.ts` is the seed) — the executable contract.

## Rules

- Effect v4 (4.0.0-beta.92): `Effect.fn`, `Schema.TaggedErrorClass`, `Effect.retry(Schedule...)`. `Effect.runPromise` ONLY at the existing Promise boundary where {FILES}' current callers sit — callers outside {FILES} keep their signatures this wave.
- Delete replaced code in the same change. No dual paths, no shims, no re-exports of dead symbols.
- Divergences: the three pre-seeded rows (delivery-at-yield I5, timeout-unreachable-after-yield I3, silence-abolished I1/I9) MAY land here if {FILES} owns those seams; each lands as a `DIVERGENCES.md` row edit citing the clause. Any OTHER behavior change = STOP, report, do not improvise.
- Bun's comment rule: if you need a paragraph to justify a workaround, the code is wrong — redesign inside the contract.
- Tests: seam suite green (parity portions byte-compatible with old behavior; contract portions green where your port implements a ledgered divergence). Extend the seam suite for every invariant edge your files own (I1/I2/I4/I5/I7/I8 as applicable). tmpdir isolation, injected `IrcExternalBus`, `OMP_SESSION_CONTROL_DB` under tmp.
- NEVER run project-wide gates; focused suites + package `check:types` only. NEVER git. No sudo.

## Yield report (JSON)

files, inventory rows addressed (count per lens + any row you dispute with rationale), divergence rows added, primitives introduced (and hand-rolled code deleted, line counts), test suites + counts (before/after), check:types status, open risks for reviewers.
