# Harness reliability and hermetic testing program

> **Provenance — 2026-07-28.** Landed from `review/harness-reliability-plan` (`streams/harness/RELIABILITY-TESTING-PLAN.md`), authored by Arthur's harness lane on 2026-07-27. Machine measurements and phase-status snapshots were refreshed or removed; current infrastructure authority is linked rather than copied. Testing-talk research and the Hegel/Bombadil verdict are referenced, not restated.

Status: active program
Owner: harness stream
Implementation baseline: current `main`

## Purpose

Make OMP safer to develop and operate by moving build, load, concurrency, long-transcript, fault, and replay testing off the Mac and into disposable NixOS test worlds on nixbox. Keep the Mac as the cmux control, review, authentication, and native-application proof surface.

This document owns the program, sequencing, and exit criteria. The portable ontology is [`validation-charter.md`](validation-charter.md); detailed testing strategy is [`docs/learning/omp-testing-strategy.md`](../learning/omp-testing-strategy.md); rollout mechanics are [`docs/learning/kubernetes-rollout-patterns.md`](../learning/kubernetes-rollout-patterns.md). Source research lives in [`docs/research/testing-talks/`](../research/testing-talks/) and the grounded [`DST, Hegel, Bombadil verdict`](../research/dst-hegel-bombadil-verdict.md). This program links those authorities rather than repeating them.

## Locked decisions

1. **Mac is the control plane, not the load generator.** No load, concurrency, long-transcript, fuzz, fault, VM, or full-suite workload runs on it.
2. **nixbox is the execution host.** Tracked source moves through Git. Build/test outputs, stores, VM disks, and load artifacts stay remote. The canonical topology is [`docs/state/agents-topology.md`](../state/agents-topology.md).
3. **NixOS pins the environment; it does not create determinism.** Tests still need explicit barriers, seeds, clocks, identities, and invariants.
4. **OMP-owned state stays real.** Journals, SQLite, filesystems, processes, signals, PTYs, and IPC are not mocked in behavioral tests.
5. **External entropy is controlled.** Provider sampling/auth/network and unsafe external tools use Live, Recording, Replay, Scripted, or Rejecting boundary implementations.
6. **Snapshots supplement invariants.** A golden projection cannot decide correctness or replace an ownership, ordering, terminality, or no-mutation assertion.
7. **One behavioral change per PR.** Dirty workspaces, caches, credentials, sessions, SQLite/WAL files, and release trees are never migrated as source.
8. **Cross-host fleet redesign is deferred.** Start with one enrolled host and typed read-only status. Durable send and mutation require destination persistence and receipts.
9. **cmux-tui and Chromium are deferred.** Stable cmux terminal/Dock/browser primitives are the review path; nightly is a tagged lab only.
10. **Effect Cluster is deferred.** Adopt Effect Schema/RPC shapes, Scope/Layer, and TestClock now; prove a narrow durable-command spike before accepting unstable distributed surface.
11. **Every spawn declares model and effort.** Runtime routing remains authoritative; orchestration never relies on implicit inheritance.
12. **Resume and salvage before respawn.** Work can outlive an agent; recover durable journals/changes before creating a replacement.

## Runtime boundary

```text
Mac: cmux + enrollment + review + native proof
  -> pinned HostId and SSH host key
  -> authenticated tailnet transport
nixbox: source workspace + OMP processes + journals + SQLite
  -> disposable NixOS VM/test cell
  -> proof artifacts + reviewed Git change
  -> cmux terminal/browser review on Mac
```

Machine capacities and layouts belong to the nixbox wiki and [`agents-topology.md`](../state/agents-topology.md), not this program. Execution is governed by the capability-derived [`nixbox bounded execution policy`](../state/nixbox-execution-policy.md).

Tailscale names and addresses are routes, not authority. Durable identities are `HostId`, `SessionId`, owner epoch, test `RunId`, and content/build digests. PIDs, sockets, absolute paths, cmux surface references, and IP addresses are host-local observations.

## Effect boundary

```text
Read effects
  Provider / Config / Files / SQLite / Clock
        ↓
Pure decisions
  Decode / Route / Transition / Plan / Parse
        ↓
Write effects
  Journal / DB / Tools / Processes / UI
```

- Core transition functions accept decoded values and return explicit next state/actions.
- Effect `Schema` decodes every provider, process, file, RPC, and SQLite boundary.
- `Layer` supplies Live, Replay, Scripted, Rejecting, and test services.
- `Scope` owns in-process resources and reconnect-loop cleanup; it is not host/process supervision.
- `TestClock` proves policy timing. Separate real-process `TZ` cells prove runtime/tzdata integration.
- Unstable distributed packages remain research spikes; they do not replace host enrollment, SSH identity, SQLite authority, or VM fault control.

## Test cells

| Cell | Real boundary | Controlled input | Main proof |
|---|---|---|---|
| Pure/property | Pure transition/decoder | Generated values and commands | Invariants, metamorphic equivalence |
| Compatibility | Current and prior blessed decoder | Hand-authored N/N-1 fixtures | Supported-version policy, no mutation |
| Provider replay | Real app/server/routes/storage | Provider-neutral event cassette | Zero-spend behavioral E2E |
| Process lifecycle | Real parent/child binaries and state | Named barrier and signal | Recovery, fencing, one terminal result |
| Storage fault | Real filesystem and SQLite | Quota, ENOSPC, WAL holder, corruption point | Atomicity, recovery, fail-closed behavior |
| Network fault | Real sockets/processes | Partition, delay, reset | Idempotency, reconnect, truthful state |
| Time fault | Real process plus Effect clock | `TZ`, pinned tzdata, clock advance | Deadline/DST policy and integration |
| Resource/load | Real OMP process forest | Cgroup memory/CPU, corpus, spawn schedule | Admission, bounded RSS, graceful pressure |
| UI exploration | Real TUI/browser surface | Seeded actions | Temporal interaction properties |
| Live canary | Real provider/auth/wire | One capped request | Provider contract only |

Every cell emits a manifest containing Git commit, OMP digest, Nix generation, scenario version, seed, `RunId`, input hashes, observed process identities, invariant results, and artifact hashes. A rerun needs no credentials unless explicitly a live canary.

## LLM provider testing

Contract:

- `LiveProvider`: production network/auth.
- `RecordingProvider`: live call plus redacted provider-neutral event cassette.
- `ReplayProvider`: exact request-digest match and ordered event replay.
- `ScriptedProvider`: authored failures, partial streams, tool fragments, cancellation, and timing.
- `RejectingProvider`: fails on unexpected provider/network access.

Keep prompt construction, routing, parser, isolated real SQLite/journals/provenance, fixture-local tools, server, routes, and UI real. Replace only expensive or nondeterministic sampling and unsafe external effects.

Missing, ambiguous, stale, or prompt-digest-mismatched cassettes fail closed. They never silently return an old answer or fall through to live. Historical transcripts are inert inputs; recorded tool calls execute only when a scenario explicitly routes an allowlisted fixture-local tool through the real dispatcher.

## Process and memory snapshots

A memory snapshot is structured telemetry, not a VM dump:

- `RunId`, logical process role, stable session/agent identity, PID start fingerprint;
- parent/child edges and ownership epoch;
- RSS, JSC heap, native/external memory where available;
- open descriptor/socket counts;
- journal/SQLite sizes and queue depths;
- sampled-at monotonic and wall-clock timestamps;
- workload phase and last named barrier.

Sample the full process forest at bounded intervals. Preserve compact time-series summaries plus event-aligned samples, not raw `/proc` dumps. Differential runs compare blessed and candidate releases under the same corpus, seed, schedule, cgroup, and Nix generation.

## Host resource contract

### Mac

Use one cross-session host admission authority:

- a finite memory budget and finite concurrency cap;
- per-attempt reservation matching the worker watchdog;
- deduplicated descendant RSS for fresh local coordinator roots;
- FIFO, cancellation, process-identity fencing, and dead-holder-only reaping;
- no timeout admission bypass;
- pressure blocks new work and may reclaim only idle owned children;
- active or foreign coordinators are never killed automatically;
- typed pressure/status projection for cmux.

Coordinator auto-restart remains gated on real kill/restart proof.

### nixbox

The execution profile is capability-derived and bounded under [`docs/state/nixbox-execution-policy.md`](../state/nixbox-execution-policy.md). The host always retains explicit system/build/virtualization headroom. A larger budget requires a deliberate infrastructure contract change, refreshed capability receipt, and no-swap-thrash smoke. Zero configured concurrency means resource-bounded, not unlimited.

## NixOS fault layer

The reusable fault runner is separate from product code. It provisions disposable cells from a pinned environment and exposes typed operations:

- boot, barrier wait, process signal, restart;
- cgroup memory/CPU adjustment;
- filesystem quota/fill/corruption point;
- SQLite lock/WAL pressure;
- network partition/delay/reset;
- process-local `TZ` and, only when required, VM wall-clock manipulation;
- artifact collection and teardown.

Application scenarios describe topology, commands, barriers, faults, and invariants. The runner owns VM lifecycle. A scenario cannot shell into an untyped success condition or treat missing telemetry as a pass.

## cmux and review loop

One workstream maps to one cmux workspace. Stable cmux hosts:

- remote orchestrator terminal;
- followed worker surfaces;
- signal pane for errors, receipts, and resource pressure;
- browser surface for dashboards, PRs, HTML reports, and proof artifacts;
- later, a read-only Dock `omp hub` for navigation.

Remote review servers bind loopback. A supervised forwarder resolves the current backend, owns the tunnel/alias, reports degraded state, and opens the exact browser surface without stealing focus. The first hub is read-only; remote mutation waits for destination-host durable receipts. Intent and taste live in [`docs/state/cmux-interface-direction.md`](../state/cmux-interface-direction.md).

## Source and PR migration

1. Freeze the reviewed baseline.
2. Transfer tracked Git source only; exclude scratch, caches, secrets, sessions, databases/WAL, build outputs, and live releases.
3. Create one described change/workspace per behavior.
4. Reconstruct from the smallest source seam; never merge historical stacks wholesale.
5. Run only focused hermetic cells for that behavior.
6. Save proof receipt and rerun command.
7. Push one branch and open one PR through the current canonical-repo/mirror process.
8. Close adversarial review findings in the same change; rerun the focused union.
9. Merge only after Arthur review.

Historical classifications remain guidance, not a ref-status ledger:

- **Rebuild after lifecycle tests:** config durability, crash resume, ownership terminality, task capability, history selectors.
- **Hybrid/defer:** provider gateway/recovery, remote preview, sparse remote lanes, cmux/tmux integration, cross-host auth.
- **Mac-only proof:** cmux native/Swift, Touch ID, macOS browser/app behavior.
- **Quarantine:** disk-pressure semantics, outbox retention, security activation, fleet redesign, duplicates/empty changes, caches, and release artifacts.

## Program phases and exit criteria

| Phase | Exit criteria |
|---|---|
| Mac emergency stop | No local load agents/tests; pressure recovery observed |
| nixbox source/runner | Clean tracked workspace; pinned capability receipt; disposable cell command |
| Global resource admission | Focused nixbox tests green; adversarial review closed; typed status visible |
| Compatibility corpus | N/N-1 fixtures, explicit supported-version policy, no-mutation audit |
| Lifecycle fault harness | Real kill/restart at named barriers; stale owner rejected; one terminal result |
| Provider replay testkit | Provider boundary contract suite; zero-spend behavioral E2E |
| Storage/network/time cells | ENOSPC/WAL/partition/DST scenarios with typed invariants |
| cmux read-only cockpit | Host/session/child/log/PR/resource navigation; no remote mutation |
| Changeset migration | One behavior per PR with hermetic receipt and Arthur review |
| Property/UI pilots | An existing suite demonstrates better shrink/replay value before adoption |
| Durable-command spike | Kill/reconnect/duplicate delivery yields one transition and original receipt |

Phase status is deliberately not frozen here; current status belongs in lane receipts and the active work tracker.

## Review sequence

1. Global resource admission and typed status.
2. N/N-1 compatibility corpus.
3. Real subprocess kill/restart harness.
4. Complete root/readiness canary.
5. Read-only cmux attention/workspace/resource surface.
6. Provider replay boundary.

No broad unfinished implementation is imported before the test that defines its contract exists.

## Risks and decisions

- **Memory pressure:** orchestration can retain large transcript/tool context. Keep Mac work bounded; testing and large implementation lanes execute remotely.
- **Virtualization:** every runner receipt records whether requested acceleration and fault controls were actually applied.
- **VM clock:** prefer TestClock and process `TZ`; mutate VM wall time only for OS integration.
- **Golden drift:** hand-authored invariants precede snapshot blessing. Candidate/blessed disagreement triggers investigation, not automatic blessing.
- **Unstable APIs:** beta distributed APIs stay isolated and cannot become identity or persistence authority without a separate decision.
- **Review path:** HTML/React proof without a live cmux review surface is incomplete; a dashboard without artifacts and rerun verbs is also incomplete.
