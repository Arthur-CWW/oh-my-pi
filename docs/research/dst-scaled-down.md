# Scaled-Down Deterministic Simulation Testing (DST)

> Research survey, 2026-07-04. Scope: the cheap 80% of Antithesis-style DST for a
> solo-dev TypeScript/Bun + Effect v4 codebase — control-plane daemon, message bus,
> packet-claim logic. All tool claims are linked; secondhand claims are marked.

## Executive summary

**Question.** How much of Antithesis-style deterministic simulation testing (DST) can a
solo-dev TypeScript/Bun + Effect v4 project (control-plane daemon, message bus, packet-claim
logic) get without a platform, and what should be designed in from day one?

**Answer: most of it, unusually cheaply — because of two accidents in your favor.**
JavaScript is already single-threaded with run-to-completion semantics, so the hardest problem
DST platforms solve (OS-thread interleaving in unmodifiable software) doesn't exist here.
And Effect's service architecture already inverts every source of nondeterminism: time, randomness,
and I/O are injectable services by construction. What Antithesis sells — a deterministic hypervisor,
multiverse debugging, coverage-guided exploration of *unmodified* systems — is the answer to a
retrofit problem you don't have. What transfers directly is their *methodology*: seeded randomized
workloads, cooperative fault injection, and `always`/`sometimes` invariant assertions.

**The minimal stack (all verified against source, §4):**

- **Time** — Effect v4 `TestClock` (`effect/testing`): `TestClock.layer()` provides `Clock.Clock`,
  so every `Effect.sleep`/timeout/retry/schedule is driven by `TestClock.adjust(duration)` /
  `setTime(ts)`. Time-based tests run instantly — TigerBeetle's "speed up time arbitrarily," free.
- **Randomness** — `Random.withSeed(seed)` (v4; there is no separate TestRandom): one combinator
  makes every `Random.next*` / `shuffle` / `choice` in the program reproducible from a seed.
- **Runner** — `@effect/vitest`'s `it.effect` auto-provides the test context (TestClock at epoch 0).
- **Interleaving exploration** — fast-check's `fc.scheduler()`: wrap bus/DB calls with
  `s.scheduleFunction`, drive with `s.waitIdle()`/`waitFor()`; failing orderings shrink and replay
  by seed. This is the JS analogue of AWS's shuttle. `fc.schedulerFor([...])` scripts regressions.
- **Environment** — ~200–500 LOC you own: an in-memory `MessageBus` layer with seed-driven
  delay/drop/duplicate knobs; real in-memory SQLite behind a buggify wrapper (seeded `SQLITE_BUSY`,
  crash-between-write-and-commit); `always` invariants checked every step (≤1 live claim per
  packet) plus `sometimes` coverage counters (contention actually happened) asserted per batch.

Total: zero new runtime frameworks — effect + fast-check (which effect already re-exports as
`effect/testing` → `FastCheck`) + vitest glue + a small owned harness.

**Design in from day one:** no `Date.now`/raw timers (Clock only), no `Math.random` (Random only),
all I/O behind `Context.Tag` services with prod + simulated layers, single-writer event-loop core,
and every simulated run keyed by a printed `(seed, config)`. Retrofit is where DST costs explode
(Polar Signals had to compile Go to single-threaded WASM to get there); design-in is a lint rule.

**Explicitly skip:** hypervisors, multi-process simulation, disk-sector fault models, exhaustive
model checking (no data races in JS), and DST framework dependencies.

**Decision rule (§6):** timing diagram → DST; input value → plain fast-check; screenshot/config →
e2e (keep a thin real smoke layer — simulation hides integration bugs by construction).

---

## 1. What Antithesis actually does

Antithesis is an autonomous testing *platform*, not a library. Its pieces, per its own docs
([DST explainer](https://antithesis.com/docs/resources/deterministic_simulation_testing/),
[how it works](https://antithesis.com/docs/introduction/how_antithesis_works.md)):

1. **Deterministic hypervisor.** Your entire system (packaged as Docker Compose or Kubernetes)
   runs inside a bespoke hypervisor that makes *unmodified, ordinarily nondeterministic software*
   execute deterministically — thread scheduling, clocks, randomness, and network are all under
   platform control. Execution can be snapshotted, branched, and rewound ("multiverse debugging").
   Background: [Pragmatic Engineer deep-dive](https://newsletter.pragmaticengineer.com/p/antithesis),
   [materialized view on the hypervisor](https://materializedview.io/p/open-source-deterministic-hypervisors). *(secondhand: both are third-party writeups, consistent with Antithesis' own docs)*
2. **Fault injection** at the environment level: network faults, node failures/restarts, thread
   pausing ([fault injection docs](https://antithesis.com/docs/concepts/fault_injection.md),
   [fault types](https://antithesis.com/docs/concepts/fault_injection/fault_types.md)).
3. **Property-first assertions via SDKs** — the part that is *plain library code in your process*:
   - `always(cond, msg)` — must hold on every evaluation (safety).
   - `sometimes(cond, msg)` — must hold on *at least one* evaluation across the whole testing
     campaign; this is a coverage-of-behavior check ("did the interesting state ever happen?"),
     not a pass/fail check on a single run.
   - `reachable`/`unreachable` — code-path variants of the same idea.
   Docs: [properties & assertions overview](https://antithesis.com/docs/concepts/properties_assertions/overview.md),
   [sometimes assertions](https://antithesis.com/docs/concepts/properties_assertions/sometimes_assertions.md),
   [Go SDK](https://github.com/antithesishq/antithesis-sdk-go) (packages `assert`, `random`,
   `lifecycle`), and a [JavaScript SDK](https://antithesis.com/docs/reference/sdk/javascript_sdk.md).
4. **Guided state-space exploration**: seeded randomized workloads plus coverage feedback decide
   which branches of the "multiverse" to explore further ([how it works](https://antithesis.com/docs/introduction/how_antithesis_works.md)).

**Platform-only vs locally reproducible.** Antithesis' own DST explainer draws exactly this line:
there are two ways to get determinism — (a) *design the system so every nondeterministic component
is pluggable* (the FoundationDB approach, practical if you control the code), or (b) *run
unmodified software under a deterministic hypervisor* (their product, needed when you can't do (a))
([source](https://antithesis.com/docs/resources/deterministic_simulation_testing/)).

| Piece | Needs their platform? |
| --- | --- |
| Deterministic execution of unmodified multi-process/multi-thread software | Yes — hypervisor |
| Branch/rewind/multiverse debugging, coverage-guided exploration at scale | Yes |
| OS-level fault injection (thread pause, node kill) without code changes | Yes |
| `always`/`sometimes`/`reachable` assertion style | No — trivial to reimplement (counters + end-of-run check) |
| Seeded randomized workload generation | No — any seeded PRNG |
| Fault injection at *your own* service boundaries (buggify-style) | No |
| Deterministic execution of code you design for it | No — that's the FDB pattern, §2 |

For a single-process TypeScript daemon you control end-to-end, (a) is available and cheap — the
hypervisor solves a problem you don't have.

## 2. The FoundationDB / TigerBeetle in-process DST pattern

**FoundationDB.** The canonical design ([official testing docs](https://apple.github.io/foundationdb/testing.html)):
the *entire cluster* — multiple processes, network, disk — runs deterministically inside a
**single-threaded process** with virtual time. All concurrency is written in Flow (a C++ actor
DSL), and every nondeterministic dependency sits behind an interface (`INetwork`, `IAsyncFile`,
clock) that gets swapped for a simulated implementation in tests. Determinism means: same seed ⇒
same execution. On top of that, the `BUGGIFY` macro cooperatively injects rare behaviors
(random errors, delays, small buffers) at points the developers marked. Fault schedules (partitions,
disk corruption, machine kills) come from test files. Good secondary sources:
[Pierre Zemb's walkthrough](https://pierrezemb.fr/posts/diving-into-foundationdb-simulation/) and
FDB's in-repo [simulation subsystem doc](https://github.com/apple/foundationdb/blob/main/design/AI-generated/subsystem_12_simulation_testing.md)
("no parallelism + quantized execution + deterministic behavior").

**TigerBeetle (VOPR).** Same pattern in Zig, described firsthand in
[docs/internals/vopr.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/internals/vopr.md):

- All nondeterministic parts — clock, network, disk — are stubbed out in the simulator.
- A single **seed** (plus git commit) tunes fault injection: drop/reorder packets, partition the
  network, corrupt reads/writes to the simulated disk. Any failure replays exactly from the seed.
- The simulator can **speed up time arbitrarily** — "one minute of VOPR time is equivalent to days
  of real-world testing."
- It leans on **thousands of in-code assertions** (kept on in production) plus external *checkers*
  over cluster state (e.g. replica data files must be byte-identical across caught-up nodes).
- Hard-to-randomly-reach scenarios get deterministic scripted tests on the same simulated
  infrastructure ([replica_test.zig](https://github.com/tigerbeetle/tigerbeetle/blob/main/src/vsr/replica_test.zig)).
- Live demo: <https://sim.tigerbeetle.com> (the whole cluster runs in a browser tab — possible
  precisely because everything is a deterministic single-threaded state machine;
  [blog](https://tigerbeetle.com/blog/2023-07-11-we-put-a-distributed-database-in-the-browser/)).

**Retrofit vs design-in.** The consistent finding across the ecosystem:

- *Design-in is discipline, not framework.* The requirements are: single logical thread of control;
  every I/O, timer, and RNG behind an injectable interface; core logic as a state machine driven by
  an event loop. If you start this way, the "simulator" is a few hundred lines of in-memory fakes.
- *Retrofit is expensive.* Antithesis' docs call the FDB approach "generally impractical for
  systems already in production" ([source](https://antithesis.com/docs/resources/deterministic_simulation_testing/)).
  Polar Signals, retrofitting DST onto Go, had to compile the whole program to **single-threaded
  WASM** and patch the runtime to control scheduling and time, and still called it "(mostly)
  deterministic" ([firsthand post](https://www.polarsignals.com/blog/posts/2024/05/28/mostly-dst-in-go));
  their later Rust take restructured the system as a "theater of state machines"
  ([post](https://www.polarsignals.com/blog/posts/2025/07/08/dst-rust)). *(claims per their posts)*
- **TypeScript's structural advantage:** JS is already single-threaded with run-to-completion
  semantics. The OS-thread-interleaving problem that forces Go/Rust/C++ into hypervisors, WASM, or
  custom runtimes *does not exist* (unless you add Workers). Nondeterminism enters only through:
  `Date.now`/timers, `Math.random`, I/O completion order (network, fs, IPC), and promise resolution
  order downstream of those. Control those four and you have determinism. This is why the pattern
  is unusually cheap in JS/TS.

Local prior art: `packages/dst-mini-rs` in this repo is already a hand-rolled miniature of this
pattern (seeded `XorShift32`, event queue ordered by virtual time, simulated node states and
pending writes) — evidence the shape is understood here; the question is only how to get it
idiomatically in Effect v4.

## 3. Rust ecosystem reference points

Useful as a map of *what kinds of tools exist*, because the JS equivalents slot into the same boxes.

| Tool | What it is | What it covers | What it doesn't |
| --- | --- | --- | --- |
| [madsim](https://github.com/madsim-rs/madsim) | Deterministic drop-in replacement for the tokio runtime (idea borrowed from FoundationDB, per its README) | Whole-system simulation: seeded scheduling, simulated time/network with packet loss & partitions, node crash/restart; production code unchanged (compile-time swap). Used by RisingWave. | OS-thread code outside the runtime; disk faults (limited) |
| [turmoil](https://github.com/tokio-rs/turmoil) (tokio-rs) | "Deterministic simulation testing of distributed systems… runs multiple concurrent hosts within a single thread and injects hardship — latency, drops, partitions, crashes" (README) | Multi-host protocol logic over a simulated network, in one thread | You must write against turmoil's net types; not a general interleaving explorer |
| [shuttle](https://github.com/awslabs/shuttle) (AWS) | **Randomized** concurrency tester for `std::sync`-style code; implements PCT (probabilistic concurrency testing) with probabilistic bug-finding guarantees; "not sound" but scalable (README) | Thread-interleaving bugs in shared-memory code, at scale, with seed replay | Environment simulation (no network/disk story) |
| [loom](https://github.com/tokio-rs/loom) | **Exhaustive** model checker: "runs tests many times, permuting the possible concurrent executions" under the C11 memory model ([docs.rs](https://docs.rs/loom/latest/loom/)) | Small critical sections, lock-free structures, atomics ordering | Blows up on anything large; soundness–scalability trade-off vs shuttle |

Two orthogonal axes fall out of this table:

1. **Environment simulation** (madsim, turmoil ≈ the FDB pattern): fake time, network, disk;
   determinism from a seed.
2. **Interleaving exploration** (shuttle randomized, loom exhaustive): perturb *scheduling order*
   to flush out races.

You want a little of both. In JS the second axis shrinks dramatically — there are no data races,
only *promise/event ordering* races — and that is exactly the axis `fc.scheduler` covers (§4).
There is no meaningful loom-equivalent for JS, and none is needed: the memory-model dimension
doesn't exist.

## 4. TypeScript/JS reality

### 4.1 Fake timers (table stakes)

[@sinonjs/fake-timers](https://github.com/sinonjs/fake-timers) and Vitest's
[`vi.useFakeTimers()`](https://vitest.dev/api/vi.html#vi-usefaketimers) monkey-patch
`setTimeout`/`setInterval`/`Date` globally. They make *time* deterministic but nothing else, and
global patching is at odds with dependency-injected code. If you're on Effect, prefer the Clock
service (below) — same capability, no patching.

### 4.2 Effect v4 test services — verified against source

Effect v4 (the [effect-smol](https://github.com/Effect-TS/effect-smol) repo, "Effect v4.0.0-beta")
ships a testing namespace at
[`packages/effect/src/testing`](https://github.com/Effect-TS/effect-smol/tree/main/packages/effect/src/testing)
containing exactly: `TestClock.ts`, `TestConsole.ts`, `FastCheck.ts`, `TestSchema.ts`, `index.ts`.

**TestClock** ([source](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/testing/TestClock.ts)) —
a controllable implementation of the `Clock` service. Verified API (names from source):

- `TestClock.make(options?: { warningDelay?: Duration.Input })` — construct.
- `TestClock.layer(options?)` — `Layer<TestClock>` that *provides `Clock.Clock`*, i.e. every
  `Effect.sleep`, `Effect.timeout`, retry/schedule/repeat combinator in the program under test is
  driven by it, with no code changes.
- `TestClock.adjust(duration)` — advance virtual time; "any effects that were scheduled to occur
  on or before the new time will be run in order."
- `TestClock.setTime(timestamp)` — jump to an absolute time.
- `TestClock.withLive(effect)` — escape hatch to the real clock for one effect.
- `testClock.currentTimeMillisUnsafe()` / `currentTimeNanosUnsafe()` — read virtual time.
- Built-in hang detection: if a test uses time without advancing the clock, it logs a warning
  after `warningDelay` (default 1 second, on the live clock).

Usage shape (from the module's own doc example): fork the effect under test
(`Effect.forkChild`), `yield* TestClock.adjust("1 minute")`, then join and assert. Time-based
tests run in microseconds instead of minutes — the same "speed up time arbitrarily" property
TigerBeetle brags about, for free.

**Seeded randomness: `Random.withSeed` (v4 has no separate TestRandom).** Verified against
[`packages/effect/src/Random.ts`](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/Random.ts):

- `Random` is a `Context.Reference` (a *defaultable* service — no mandatory layer wiring) with the
  minimal interface `{ nextIntUnsafe(): number; nextDoubleUnsafe(): number }`.
- Generators flow through it: `Random.next`, `Random.nextBoolean`, `Random.nextInt`,
  `Random.nextBetween(min, max)`, `Random.nextIntBetween(min, max, { halfOpen? })`,
  `Random.shuffle(iterable)`, `Random.choice(elements)`.
- `Random.withSeed(seed: string | number)` (`@since 4.0.0`) runs any effect with a deterministic
  ISAAC-CSPRNG-backed `Random` service: "Using the same seed produces the same random sequence,
  which is useful for tests and reproducible simulations" (source docstring). Usage:
  `program.pipe(Random.withSeed("seed-42"))`.
- Contrast: Effect v3 exposed a `TestRandom` via `TestContext`
  ([v3 TestClock docs](https://effect.website/docs/testing/testclock/) for the v3 shape); in v4
  the seeded-service approach replaces it.

**FastCheck re-export.** [`effect/testing/FastCheck.ts`](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/testing/FastCheck.ts)
is literally `export * from "fast-check"` — fast-check is an Effect dependency, blessed as the
property-testing story (`import { FastCheck } from "effect/testing"`).

**@effect/vitest.** Exists for v4 in-repo
([packages/vitest](https://github.com/Effect-TS/effect-smol/tree/main/packages), README verified
[here](https://github.com/Effect-TS/effect-smol/blob/main/packages/vitest/README.md)):
`import { it } from "@effect/vitest"` gives `it.effect` (auto-injects the `TestContext`, including
`TestClock` — clock starts at epoch 0), `it.live` (real environment), `it.scoped`, `it.scopedLive`,
`it.flakyTest`, plus `.skip`/`.only`/`.fails` modifiers. Note it targets **vitest**, not `bun test`;
if the DST suite must run under `bun test`, `it.effect` is convenience, not necessity — the
equivalent is `Effect.runPromise(program.pipe(Effect.provide(TestClock.layer()), Random.withSeed(seed)))`.

**Is the Effect fiber runtime itself deterministic?** Fibers are cooperatively scheduled on the
single JS thread. `[INFERENCE]` Given (a) TestClock instead of real timers, (b) `Random.withSeed`,
and (c) no uncontrolled I/O, a fixed seed yields the same fiber interleaving on every run, because
JS microtask/macrotask ordering is specified and the runtime introduces no other entropy. What
Effect does **not** provide is a shuttle-style *seed-randomized scheduler* that explores different
interleavings across runs — interleaving exploration must come from fast-check (next).

### 4.3 fast-check: property-based testing + race-condition scheduler

fast-check gives seed-replayable property tests (`fc.assert` prints the failing `{ seed, path }`;
re-run with the same values to reproduce — [docs](https://fast-check.dev/docs/core-blocks/runners/)).
Its DST-relevant superpower is the scheduler, verified against the
[race-conditions docs](https://fast-check.dev/docs/advanced/race-conditions/):

- `fc.scheduler()` — an arbitrary that generates `Scheduler` instances; the *ordering decisions
  are the generated value*, so fast-check shrinks failing orderings like any other input.
- `s.schedule(promise, label?)` — wrap a promise; it resolves only when the scheduler says so.
- `s.scheduleFunction(asyncFn)` — wrap a promise-returning API (DB call, fetch, bus publish) so
  every call's *resolution* is reordered under scheduler control.
- `s.scheduleSequence(items)` — ordered multi-step workloads.
- `s.waitNext(count)` / `s.waitIdle()` / `s.waitFor(unscheduledTask)` — drive the schedule
  (`waitOne`/`waitAll` are deprecated since fast-check v4.2.0 in favor of these).
- `s.report()` — execution trace of scheduled tasks for diagnostics.
- `fc.schedulerFor([1, 3, 2])` — hardcode an ordering (the scripted-scenario analogue of
  TigerBeetle's `replica_test.zig`).

This is the JS shuttle: randomized, seed-replayable exploration of async resolution order. For
stateful targets, combine with fast-check's
[model-based testing](https://fast-check.dev/docs/advanced/model-based-testing/) —
`fc.commands` + `fc.asyncModelRun` — to fire random command sequences at a state machine and
compare against a simplified model.

### 4.4 DST-adjacent JS/TS libraries

- **[glideapps/determined](https://github.com/glideapps/determined)** — "Minimal Deterministic
  Simulation Testing for TypeScript" (MIT). Verified from its README: tasks yield at explicit
  `checkpoint()` / `failpoint()` / `blockpoint()` calls; an entropy-driven scheduler picks which
  task resumes; failpoints inject failures probabilistically; `RecordingEntropySource` /
  `ReplayingEntropySource` give record-and-replay of entire runs; ships an async `Mutex` and
  `ConditionVariable` with deadlock detection; `noSimulation` is the production no-op. Caveat:
  ~1 star, single-purpose (built for Glide's sync engine) — treat as a *pattern reference*
  (its entropy record/replay design is worth stealing), not a dependency.
- **[Antithesis JS SDK](https://antithesis.com/docs/reference/sdk/javascript_sdk.md)** — the
  `always`/`sometimes` assertion vocabulary in JS; only useful if you later buy the platform, but
  the vocabulary costs ~30 lines to self-implement.
- **Resonate** wrote a good conceptual series on DST
  ([post](https://journal.resonatehq.io/p/deterministic-simulation-testing)); their published
  implementation write-up targets their Go server *(secondhand; TS SDK DST details not verified)*.
- Nothing in the JS ecosystem matches madsim (whole-runtime swap) — and nothing needs to: the
  runtime is already single-threaded, so the swap surface is just the service layer Effect
  already gives you.

## 5. Recommendation: minimal DST stack for an Effect v4 control-plane daemon

*Standalone summary: this section assumes only the context line — a solo-dev TypeScript/Bun +
Effect v4 daemon with SQLite state, a message bus, and packet-claim (at-most-one-consumer) logic.*

### The stack (exact names)

| Concern | Use | Package |
| --- | --- | --- |
| Deterministic time | `TestClock.layer()`, `TestClock.adjust`, `TestClock.setTime` from `effect/testing` | `effect` (v4) |
| Deterministic randomness | `Random.withSeed(seed)`; all in-code randomness via `Random.next*` — never `Math.random` | `effect` (v4) |
| Test runner integration | `it.effect` from `@effect/vitest` (auto TestClock) under vitest; or plain `Effect.runPromise` + explicit layers under `bun test` | `@effect/vitest`, `vitest` |
| Property tests, seed replay, shrinking | `fc.assert`, `fc.property`/`fc.asyncProperty` | `fast-check` (already re-exported as `effect/testing` → `FastCheck`) |
| Interleaving/race exploration | `fc.scheduler()`, `s.scheduleFunction`, `s.waitIdle`, `s.waitFor`; `fc.schedulerFor` for scripted regressions | `fast-check` |
| State-machine workloads | `fc.commands` + `fc.asyncModelRun` over the claim table / bus | `fast-check` |
| Environment simulation | ~200–500 LOC of your own in-memory `Layer`s (below) | your repo |

That's **two runtime dependencies you already have (effect, fast-check) plus vitest glue**. No
framework to adopt.

### Design in from day one (the actual price of DST)

1. **All time through `Clock`** — no `Date.now()`, no raw `setTimeout`. Effect-idiomatic code
   (`Effect.sleep`, `Effect.timeout`, `Schedule.*`) already complies; the rule is "don't go around
   the runtime."
2. **All randomness through `Random`** — IDs, jitter, backoff, sampling. Then one
   `Random.withSeed(seed)` at the test root makes the whole run reproducible.
3. **All I/O behind services**: `MessageBus`, `SqlClient`/`PacketStore`, plus any FS/network access
   — each a `Context.Tag` with a production layer and a simulated layer. This is ordinary Effect
   architecture; DST is the payoff for doing it consistently.
4. **Single-writer core**: the daemon's state transitions happen on one logical event loop —
   commands in, events out, transition function as pure as possible. (Bun is single-threaded unless
   you add Workers; don't add Workers to the control plane.)
5. **Seed-first harness ergonomics**: every simulated run takes `(seed, config)`; every failure
   log line prints them. TigerBeetle's replay contract — seed + commit reproduces the bug
   ([vopr.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/internals/vopr.md)) — is
   the deliverable, not a nice-to-have.

### The simulation harness you write yourself (small, and the core of the value)

- **SimulatedBus** (`Layer` for `MessageBus`): in-memory queues; delivery order, delay
  (via TestClock), drop, and duplication decided by `Random.next` — i.e. by the seed. Knobs like
  `{ dropRate, dupRate, maxDelay }` per run.
- **SQLite**: run the real engine in-memory (`:memory:` via `bun:sqlite` or `@effect/sql-sqlite-*`)
  — synchronous and deterministic given deterministic call order — and wrap the service with a
  **buggify layer**: with probability p (from `Random`), a call returns `SQLITE_BUSY`, times out,
  or the process "crashes" between write and commit. This mirrors FDB's `BUGGIFY` (cooperative,
  developer-placed fault points; [FDB testing docs](https://apple.github.io/foundationdb/testing.html))
  at your service seam instead of the syscall layer.
- **Buggify helper**: `const buggify = (p: number) => Random.next.pipe(Effect.map(r => r < p))` —
  scatter at interesting seams (before/after commit, on claim renewal, on bus publish).
- **Invariant checkers, Antithesis-style, in ~30 lines**:
  - *always*: after every simulated step, assert e.g. "each packet has ≤1 live claim",
    "no message both acked and requeued", "sequence numbers monotonic per stream".
  - *sometimes*: counters flipped when interesting states occur ("two workers contended for the
    same packet", "a message was delivered out of order", "a claim expired mid-processing");
    at end of a batch of runs, assert every counter fired. This is the cheap reimplementation of
    [sometimes assertions](https://antithesis.com/docs/concepts/properties_assertions/sometimes_assertions.md)
    and it's what tells you your fault injection isn't a no-op.
- **Two test shapes** on top of the harness:
  1. `it.effect` + `fc.asyncProperty(fc.scheduler(), fc.array(commandArb), ...)`: random command
     workloads against the daemon with simulated bus/SQL layers, scheduler-perturbed resolution
     order, TestClock-driven timeouts/lease expiries, invariants checked throughout.
  2. Scripted regressions with `fc.schedulerFor([...])` + `TestClock.setTime` for every bug found —
     the `replica_test.zig` analogue.

### Explicitly skip

- **Deterministic hypervisor / whole-VM anything** — solves multi-process, multi-thread,
  unmodifiable-code problems you don't have.
- **Multi-process simulation** — the daemon is one process; simulate peers as in-memory actors on
  the bus instead.
- **Disk-level fault simulation** (sector corruption, misdirected writes à la TigerBeetle) — that's
  for people writing storage engines; SQLite is your storage engine and its durability is not your
  test surface. Fault-inject at the SQL service seam only.
- **A loom equivalent / exhaustive interleaving search** — no data races in JS; `fc.scheduler`'s
  randomized search with shrinking is the right cost point.
- **Adopting a DST framework dependency** (determined, custom runtimes) — the Effect service layer
  *is* the framework; keep the harness as owned code.
- **Retrofitting determinism into non-Effect corners later** — enforce rules 1–3 by lint/review
  now; retrofit is where the cost explodes (§2).

## 6. When DST pays off vs e2e/fuzz — decision rule

DST's niche: bugs that are a function of **ordering × faults × time**, in logic you own. Its cost
is the design discipline in §5 (near-zero if Effect-idiomatic) plus the harness.

- **If explaining the bug needs a timing diagram → DST.** Claim contention, lease expiry racing
  completion, bus redelivery during shutdown, retry storms. (This is the packet-claim and bus
  logic — the sweet spot.)
- **If explaining the bug needs an input value → plain property tests / fuzz.** Parsers, codecs,
  schema validation, pure planners: `fc.assert` without the scheduler or harness.
- **If explaining the bug needs a screenshot or a config file → e2e.** Wrong port, wrong SQL
  dialect, wrong OS behavior, wrong API shape from a real dependency. Simulation *hides* these by
  construction — keep a thin smoke-test layer of real end-to-end runs; DST never replaces it.
- **If the code is a stateless glue path with no ordering sensitivity → unit test and move on.**

Rule of thumb from the field: TigerBeetle runs DST because consensus + storage recovery is nearly
all timing-diagram territory ([vopr.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/internals/vopr.md));
Antithesis positions the hypervisor for systems that *can't* be designed for simulation
([their docs](https://antithesis.com/docs/resources/deterministic_simulation_testing/)). A solo-dev
Effect daemon sits in the best quadrant: small enough to design-in, concurrent enough to need it.

---

## Source index

- Antithesis: [DST explainer](https://antithesis.com/docs/resources/deterministic_simulation_testing/) · [how it works](https://antithesis.com/docs/introduction/how_antithesis_works.md) · [fault injection](https://antithesis.com/docs/concepts/fault_injection.md) · [sometimes assertions](https://antithesis.com/docs/concepts/properties_assertions/sometimes_assertions.md) · [Go SDK](https://github.com/antithesishq/antithesis-sdk-go) · [JS SDK](https://antithesis.com/docs/reference/sdk/javascript_sdk.md) · [Pragmatic Engineer](https://newsletter.pragmaticengineer.com/p/antithesis)
- FDB/TigerBeetle: [FDB testing docs](https://apple.github.io/foundationdb/testing.html) · [FDB simulation subsystem doc](https://github.com/apple/foundationdb/blob/main/design/AI-generated/subsystem_12_simulation_testing.md) · [Pierre Zemb](https://pierrezemb.fr/posts/diving-into-foundationdb-simulation/) · [TigerBeetle vopr.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/internals/vopr.md) · [sim.tigerbeetle.com](https://sim.tigerbeetle.com)
- Retrofit cost: [Polar Signals Go](https://www.polarsignals.com/blog/posts/2024/05/28/mostly-dst-in-go) · [Polar Signals Rust](https://www.polarsignals.com/blog/posts/2025/07/08/dst-rust) · [Resonate](https://journal.resonatehq.io/p/deterministic-simulation-testing)
- Rust tools: [madsim](https://github.com/madsim-rs/madsim) · [turmoil](https://github.com/tokio-rs/turmoil) · [shuttle](https://github.com/awslabs/shuttle) · [loom](https://docs.rs/loom/latest/loom/)
- Effect v4: [effect-smol testing dir](https://github.com/Effect-TS/effect-smol/tree/main/packages/effect/src/testing) · [TestClock.ts](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/testing/TestClock.ts) · [Random.ts (`withSeed`)](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/Random.ts) · [FastCheck.ts](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/testing/FastCheck.ts) · [@effect/vitest README (v4)](https://github.com/Effect-TS/effect-smol/blob/main/packages/vitest/README.md) · [v3 TestClock docs](https://effect.website/docs/testing/testclock/)
- fast-check: [race conditions / scheduler](https://fast-check.dev/docs/advanced/race-conditions/) · [model-based testing](https://fast-check.dev/docs/advanced/model-based-testing/)
- TS DST: [glideapps/determined](https://github.com/glideapps/determined)
- Curated lists: [awesome-deterministic-simulation-testing](https://github.com/ivanyu/awesome-deterministic-simulation-testing) · [Pierre Zemb's DST reading list](https://pierrezemb.fr/posts/learn-about-dst/) · [Phil Eaton on DST](https://notes.eatonphil.com/2024-08-20-deterministic-simulation-testing.html)
