# DST, Hegel, Bombadil: grounded verdict

Status: research reference, 2026-07-28. Produced by librarian lane `TestingToolsResearch`
(source-verified; citations inline). Companion to `testing-talks/`.

# Grounded report

## 1. Name check: Hegel and Bombadil are real; “antifuzzes” is almost certainly **Antithesis**

Arthur had the tool names right and the vendor name wrong. Antithesis officially identifies both as its open-source tools: **Hegel** is a family of property-based-testing libraries and **Bombadil** is property-based testing for web and terminal UIs ([Antithesis product page](https://antithesis.com/product/), [official GitHub org](https://github.com/hegeldev), [Bombadil repo](https://github.com/antithesishq/bombadil)). I found no vendor or project called “antifuzzes” associated with them.

### Hegel

- **What it is:** a universal PBT approach, derived from Hypothesis, with native libraries for Rust, Go, C++, TypeScript, Java, and OCaml. Tests generate many values, check properties, shrink failures, and retain/replay counterexamples. The official announcement also explicitly demonstrates **model-based differential testing** against a reference implementation ([announcement, 2026-03-24](https://antithesis.com/blog/2026/hegel/)).
- **Current TypeScript package investigated:** `@hegeldev/hegel` **0.4.3**, MIT. Exact package metadata and runtime dependencies are in the [manifest](https://github.com/hegeldev/hegel-typescript/blob/main/package.json).
- **Runtime/platform today:** Node 20.11+, Bun 1.2.5+, or Deno 2+; Deno needs `--allow-ffi --allow-read --allow-env`. Published native packages cover Linux amd64/arm64, macOS arm64, and Windows amd64/arm64 ([README](https://github.com/hegeldev/hegel-typescript), [0.4.3 changelog](https://github.com/hegeldev/hegel-typescript/blob/main/CHANGELOG.md)).
- **Important correction to older material:** the March announcement said Python was required. Since TypeScript 0.3.0 (2026-06-26), it calls the native Rust `libhegel` through FFI and **no longer requires Python or uv**; this is verified by the changelog and current dependencies (`koffi` plus per-platform native packages). Some official prose, including generated source docs and the compatibility page, is stale.
- **Availability/stability:** public npm package and source, MIT; **beta**, with breaking changes explicitly permitted before 1.0 ([compatibility policy](https://hegel.dev/compatibility)). It already accepts an explicit seed and supports deterministic CI mode and a failure database; the exact `Settings` fields are source-visible in [runner.ts](https://github.com/hegeldev/hegel-typescript/blob/main/src/runner.ts).
- **Not DST by itself:** Hegel generates/shrinks workloads. Its own announcement says it is not yet particularly good at highly concurrent distributed systems. It does not virtualize Bun, SQLite, processes, clocks, or I/O.

### Bombadil

- **What it is:** autonomous PBT/fuzzing for **browser and terminal UIs**. A JS/TS specification exports properties and weighted action generators; Bombadil repeatedly extracts UI state, checks temporal properties, chooses an action, performs it, and waits for navigation/DOM mutation/timeout ([manual introduction](https://antithesishq.github.io/bombadil/browser/1-introduction.html), [spec language](https://antithesishq.github.io/bombadil/browser/3-specification-language.html)). Temporal operators include `always`, `eventually`, and `next`.
- **Version investigated:** latest published release shown by official releases and manual is **0.6.1**; Rust workspace edition 2024; MIT ([releases](https://github.com/antithesishq/bombadil/releases), [Cargo.toml](https://github.com/antithesishq/bombadil/blob/main/Cargo.toml), [license](https://github.com/antithesishq/bombadil/blob/main/LICENCE)). The repo labels it new/experimental and says 0.x APIs may change.
- **Runtime/platform:** prebuilt CLI for macOS arm64 and Linux x86_64, or npm package `@antithesishq/bombadil`; specifications may be TypeScript or JavaScript. Bun can install the package, but the spec runs in Bombadil’s **limited embedded JS runtime**, not Bun/Node—packages importing Node built-ins may fail ([installation](https://antithesishq.github.io/bombadil/browser/2-getting-started.html), [spec runtime warning](https://antithesishq.github.io/bombadil/browser/3-specification-language.html#importing-modules-and-files)). Docker images were documented as not yet available.
- **Availability:** local, CI, and Antithesis use are advertised; source is MIT. Full-stack deterministic replay is an Antithesis-platform capability, not a guarantee of the local CLI.
- **Replay caveat:** local `--reproduce` replays a recorded action trace, but the manual explicitly says reproduction is **not guaranteed** and fails on divergence. That is materially weaker than TigerBeetle/Antithesis deterministic replay ([getting started](https://antithesishq.github.io/bombadil/browser/2-getting-started.html#reproducing-violations)).
- **Release-date verification:** Antithesis publicly named Bombadil in its 2026-03-18 testing article and Hegel in its 2026-03-24 launch post. I could not verify a separate official Bombadil launch announcement; the repository copyright dates to 2024, so “released in 2026” is safest phrased as **publicly promoted/released as an open-source tool by March 2026**, not necessarily first created then.

## 2. TigerBeetle-style DST: structural requirements and OMP’s achievable subset

TigerBeetle’s VOPR runs production cluster code in one process, replaces clock/network/disk, injects seeded packet, partition, crash, latency, and storage faults, advances simulated time quickly, and validates assertions plus state checkers. A seed **and Git commit** reproduce a run ([VOPR docs](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/internals/vopr.md), [simulator article](https://tigerbeetle.com/blog/2023-07-11-we-put-a-distributed-database-in-the-browser/)).

### Structural requirements

1. **Explicit state machines / serialized event execution.** The practical in-process pattern is a single-threaded discrete-event loop: choose the next event, apply one transition, run invariants, repeat. “Single-threaded” is not a universal definition of DST—Antithesis instead virtualizes ordinary software at the hypervisor—but it is the tractable TigerBeetle/FoundationDB-style architecture for reproducible scheduling.
2. **All nondeterminism behind injected seams:** monotonic/wall time, timers, random generation, scheduler choices, network/message delivery, disk/SQLite results, process exits, and fault outcomes. TigerBeetle explicitly stubs clock, network, and disk; Antithesis’s guidance calls for pluggable nondeterministic components ([official DST guide](https://antithesis.com/docs/resources/deterministic_simulation_testing/)).
3. **One seeded entropy stream or explicitly derived substreams.** Every workload choice, fault, delay, and delivery order must derive from recorded seeds; iteration order and IDs must not leak ambient randomness. Record seed + build/Git identity + config.
4. **Virtual time and event queue.** Advance directly to the next scheduled event rather than sleeping. Timeouts and retries become events, not wall-clock waits.
5. **Deterministic scheduling.** Concurrent logical actors may exist, but runnable work must be selected by the simulator, not Bun’s Promise queue, OS threads, SQLite locking, or child-process timing.
6. **A strong oracle:** assertions/invariants after transitions, plus a reference model and differential comparison. OMP’s existing reference reducer + replay against real `SessionManager` is exactly the right oracle shape.
7. **Fault model and replay artifact:** inject omission, duplication, reordering, delay, transient/permanent I/O failure, crash/restart, cancellation, and resource refusal only at explicit seams; persist the full minimized command/fault trace, seed, version, and receipts.

### What OMP can achieve today in Bun/TypeScript/Effect v4

**Achievable now:** a deterministic, seeded **logical simulator around OMP’s state-machine core**, not whole-runtime determinism.

- Installed Effect is **4.0.0-beta.92**. `TestClock` starts at epoch, controls sleeps/timeouts/schedules/retries, and runs due sleeps in order when adjusted ([installed source/API](https://effect.website/docs/testing/testclock/)).
- Effect v4 provides `Random.withSeed(seed)`, which installs a deterministic PRNG service. The user’s “TestRandom” wording matches Effect v3 documentation, but the installed v4 testing barrel exports no `TestRandom`; the current exact API is `Random.withSeed`.
- Effect’s `Scheduler` service is replaceable. Its dispatcher queues by priority, FIFO within equal priority, and exposes synchronous `flush()`. This enables a deterministic Effect-fiber test scheduler, or a simulator-owned dispatcher, **provided all relevant work stays inside Effect scheduling**.
- Generate seeded command/fault sequences; feed each command into both the reference reducer and a real `SessionManager` backed by isolated temp storage; explicitly advance `TestClock`; flush the controlled scheduler; compare normalized state and receipts after every transition; on failure save seed/build/trace and shrink the command sequence (Hegel or the already-exported Effect `FastCheck` integration can supply generation/shrinking).

**Not deterministic today without more seams:** native Promises, `setTimeout`/`Date.now` outside Effect, Bun workers/JSC behavior, OS processes/signals, filesystem ordering, external SQLite contention, network sockets, UUID/Snowflake generation, and arbitrary third-party libraries. A custom Effect scheduler does not control those. Therefore do not call the first implementation “full DST”; call it **seeded deterministic model simulation/differential replay**.

### Highest-leverage OMP targets

1. **Session/child lifecycle — highest leverage.** Model `running → idle → parked → reviving → idle/released/failed`, ownership fencing, stale-orphan reconciliation, durable terminal evidence, receipt replay/ack, crash/reopen, and timer boundaries. The current manager has coalesced concurrent park/revive/release maps and TTL timers—exactly the kind of transition interleavings a seeded event loop can explore.
2. **Spawn/admission queueing.** Exercise simultaneous completions, quota/host-resource admission, FIFO/backpressure, cancellations, retries, capacity release, parent death, and admission receipts. The smallest useful simulator makes request/complete/cancel/tick/fault commands and asserts no over-admission, no lost waiter, eventual progress after capacity, and reducer/real parity.
3. **IRC bus.** Explore send/wait/inbox, waiter matching, queued/injected/woken/revived/failed outcomes, mailbox cap eviction, timeouts, revival failure, duplicate/reordered external delivery, and read/delivery receipt invariants. It is naturally a message-passing state machine and has crisp safety properties: at-most-once successful handoff, no loss across failed revival, monotonic delivery state, and filter-correct waits.

## 3. Cost/benefit verdicts

| Tool / technique | Verdict | One-line reason | Smallest first experiment |
|---|---|---|---|
| Effect-seeded model simulation + existing reducer/differential replay | **ADOPT-NOW** | Highest leverage with existing architecture; controls logical time/randomness and reuses the strongest oracle already built. | Run 1,000 seeded 25–100-command session-lifecycle traces; compare reducer vs temp-backed real `SessionManager` after every command and persist the first failing seed/trace. |
| Hegel TypeScript 0.4.3 | **PILOT** | Excellent shrinking/database ergonomics and Bun support, but beta/native-FFI churn and no concurrency/runtime virtualization. | Port one existing differential-replay generator to `hegel.testAsync`, fixed seed in CI, and compare shrink quality/runtime against Effect FastCheck before standardizing. |
| Bombadil 0.6.1 | **PILOT** | Useful for OMP TUI/browser properties, but it tests UI exploration—not session/queue correctness—and local replay may diverge. | Run the terminal driver for 2–5 minutes against an isolated OMP session; assert no crash/error output and basic prompt/status invariants; archive trace/screenshots. |
| Full TigerBeetle-style in-process DST retrofit | **SKIP (today)** | Whole Bun/OS determinism would require replacing too many ambient timers, Promise/worker, process, filesystem, SQLite, and ID seams. | Do not build a new runtime; first inventory nondeterministic seams encountered by the session-lifecycle simulation and inject only those that block replay. |
| Antithesis hosted deterministic hypervisor | **PILOT** | It can cover ordinary multithreaded/containerized software, but access is contact/POC-based, integration needs containers/workloads, and public pricing is unverifiable. | After the local simulator has stable properties, containerize one known lifecycle/IRC race and use Antithesis’s documented two-week POC path to test whether it finds/replays it. |

## Final ≤20-line summary
1. The names **Hegel** and **Bombadil** are correct; “antifuzzes” is almost certainly **Antithesis**.
2. Hegel is MIT, Hypothesis-derived property testing; TypeScript 0.4.3 supports Bun 1.2.5+ through native Rust FFI and no longer needs Python.
3. Hegel remains beta and is a workload generator/shrinker, not a deterministic runtime.
4. Bombadil 0.6.1 is MIT exploratory PBT for browser and terminal UIs using JS/TS properties and action generators.
5. Its spec runtime is limited, and local trace reproduction is explicitly not guaranteed.
6. TigerBeetle-style in-process DST needs serialized state transitions, injected time/I/O/scheduling, seeded entropy, virtual time, invariants, and replay artifacts.
7. OMP can implement the valuable middle today: seeded logical simulation + Effect `TestClock` + `Random.withSeed` + controlled Scheduler + its existing reference reducer.
8. Effect v4 beta.92 does not export `TestRandom`; use `Random.withSeed`.
9. This will not control arbitrary Bun Promises, workers, processes, SQLite races, filesystem order, or third-party ambient time.
10. Apply it first to session lifecycle, then spawn/admission queueing, then IRC delivery.
11. **ADOPT-NOW:** reducer-backed seeded simulation.
12. **PILOT:** Hegel for generation/shrinking; Bombadil only for TUI/UI properties; hosted Antithesis after local properties stabilize.
13. **SKIP today:** a wholesale TigerBeetle-style runtime retrofit.

## Research caveats

- Official Hegel pages are internally stale: the March announcement/source prose says Python or Node-only, while the newer 0.3.0/0.4.3 changelog and package manifest verify native FFI plus Bun/Deno support. This report follows the newer implementation and release metadata.
- Bombadil's local --reproduce mode is trace replay, not guaranteed deterministic execution; the manual explicitly warns it may diverge.
- Bombadil specifications run in a limited embedded JS runtime, so Node-dependent npm packages may not work even when installation is performed with Bun/npm.
- Effect scheduler and clock control only code routed through their services; they do not make arbitrary Bun/OS/SQLite/process behavior deterministic.
- The existence and maturity of OMP's reference reducer/differential-replay layer were supplied in the assignment; the transient worktree named in context was unavailable during this read-only research pass, so recommendations using it are architectural, not a fresh execution result.
- No public Antithesis price was verified. Official availability is contact/demo and a documented two-week POC path.
