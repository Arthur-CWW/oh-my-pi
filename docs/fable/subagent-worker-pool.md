# Bounded subagent worker pool

## Decision

Long-lived in-process subagents are incompatible with OMP's workload even after correct object release. Measurements on 2026-07-13:

- Live child JS heap slope: about 261 KiB per child.
- Cold-parked post-GC slope: about 6.5 KiB per child (39.9× reduction).
- Weak references cleared for 297/300 child sessions.
- Yet RSS remained about 812 KiB per child.
- Churning 300 selected previews added 212 MiB RSS while post-GC heap grew only 0.35 MiB.
- Arthur's live coordinator reached 31.8 GiB physical footprint, 29.3 GiB swap; 29.0 GiB was WebKit/JSC malloc pages, not native malloc or VT state.

This is primarily allocator/high-water retention after legitimate churn, not a single remaining strong-reference leak. OS process exit is the reliable reclamation boundary.

## Primitive

`SubagentWorkerPool` owns a bounded number of ephemeral worker processes. The coordinator owns no live child provider/runtime objects.

Coordinator authority:

- AgentRef identity and lineage.
- Queue-v2 input state.
- Append-only child journal.
- Small final summary and delivery receipt.
- Worker assignment/lease.

Worker authority while leased:

- AgentSession/provider state for one child turn.
- Current tool executions.
- Bounded transcript projection/debug buffers.
- Heartbeat and resource report.

Worker never owns durable identity or queue authority.

## Lifecycle

1. Coordinator admits a child turn and leases an idle worker.
2. Worker reconstructs from journal/checkpoint and executes.
3. Worker journals output through the fenced coordinator contract.
4. On completion or park, worker releases the lease.
5. Coordinator retains AgentRef + journal only.
6. Worker is recycled after a small turn count or memory watermark; process exit returns JSC pages to the OS.
7. Resume leases a fresh worker and reconstructs from the journal.

## Bounds

- Configurable pool width; default equal to actual active concurrency, not historical child count.
- Worker max turns and max RSS/footprint.
- Coordinator emergency threshold invokes graceful worker recycling; coordinator restart is last resort.
- Parked/completed detail budget: under 10 KiB per child in coordinator estimates.
- Exactly one selected Hub preview while visible; no warm preview cache.
- Terminal job summaries capped (32 KiB default); watched/pending delivery records never pressure-evicted.

## Composition

Uses existing primitives rather than duplicating them:

- AgentRef: target/lineage.
- Queue-v2: admission and replay dedupe.
- Child journal: reconstruction and truth.
- owners-v1/epochs: worker lease fencing.
- DeliveryRecord: result transport.
- Restart handoff: coordinator recovery.

## Non-goals

- One OS process per historical child forever.
- Moving journal authority into workers.
- Sharing mutable AgentSession instances between processes.
- Using libghostty for memory compression; libghostty-vt addresses terminal emulation only.

## Migration

1. Extract a process worker around the existing embedded SDK readiness worker pattern.
2. Route isolated/non-isolated child execution through one worker protocol behind a feature flag.
3. Prove process-level exactly-once queue/journal behavior and memory reclamation at 50/300 child churn.
4. Make worker pool default; delete in-process child execution path rather than retain compatibility modes.
