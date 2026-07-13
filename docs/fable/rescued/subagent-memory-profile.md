> Rescued 2026-07-13 from /Users/arthur/agents/local/subagent-memory-profile.md

# OMP subagent JSC memory profile

Date: 2026-07-13. Runtime: Bun 1.4.0 / JSC, Darwin 25.5 arm64. Arthur's pid 17389 was not touched.

## Reproduction and evidence

Two read-only/throwaway probes were used:

1. The repository's process-isolated real `AgentSession` lifecycle benchmark:
   `cd vendor/oh-my-pi && bun --expose-gc packages/coding-agent/bench/lifecycle-memory.ts`
2. `bun --expose-gc local/subagent-memory-probe.ts`, which creates 50/100/300 real `AgentSession`, `SessionManager`, `AgentRegistry`, and `AgentLifecycleManager` instances. Each child has two 256 KiB transcript messages, IRC-history-shaped slices, a completed-job-shaped 256 KiB delivery, eight raw SSE events in the real `RawSseDebugBuffer`, a real session subscription/timer, running→idle→parked transitions, bounded single-preview selection churn, and a rebuilt parent projection. Every reported phase follows two full `Bun.gc(true)` calls. The 300-child detached heap is `local/subagent-memory-300-detached.heapsnapshot`.

The extended probe is deliberately same-process and therefore its per-child deltas include JIT/module warmup and JSC page reuse. The process-isolated lifecycle slopes are the reliable object-heap slopes.

## Measured slopes

### Process-isolated real lifecycle benchmark

| phase | JSC `heapUsed` bytes/child | RSS bytes/child | live sessions/subscriptions/timers after phase |
|---|---:|---:|---|
| baseline | -429 | -471 | 0/0/0 |
| live idle, 256 KiB transcript | 261,280 | 805,470 | N/N/N |
| parked + forced GC | 6,543 | 811,874 | 0/0/0 |
| revived | 368,142 | 843,380 | N/N/N |
| re-parked + forced GC | 7,434 | 845,207 | 0/0/0 |

Cold parking reduces the reachable heap slope by 39.9× (261,280 / 6,543). RSS does not fall and slightly rises. This is direct evidence that RSS is dominated by JSC heap pages retained after objects become unreachable, not by an equivalent live-object graph.

### Extended workload, delta from the in-process baseline divided by N

Each cell is `heapUsed / RSS` bytes per child after forced GC.

| N | live completed | one-preview churn | parent messages rebuilt | cold parked | detach + preview/projection release |
|---:|---:|---:|---:|---:|---:|
| 50 | 684,949 / 366,674 | 693,308 / 1,131,151 | 693,308 / 1,195,377 | 683,717 / 1,206,518 | 683,717 / 1,207,173 |
| 100 | 156,040 / 12,124 | 158,119 / 511,836 | 158,119 / 533,135 | 161,400 / 534,282 | 137,996 / 534,282 |
| 300 | 198,278 / 20,589 | 199,452 / 727,450 | 199,400 / 729,197 | 199,400 / 730,453 | 180,282 / 730,453 |

The extended probe's live reachable footprint is intentionally larger and more varied than the isolated 256 KiB benchmark. Its important result is the separation: at N=300, preview churn adds only 352,228 bytes of reported heap after GC but adds 212,058,112 bytes RSS. Clearing the preview and parent projection does not return those pages to the OS. Parent rebuild adds ~0 heap and 524 KiB RSS at N=300. These are page-retention/high-water effects, not evidence of a strong preview graph after release.

WeakRef evidence: before park all N sessions dereference. After real `AgentLifecycleManager.park`, only 2–3 loop-edge sessions dereference; 297/300 sessions are collected. Registry descriptors remain N by design, with `session === null`. Thus parked descriptors are not retaining full sessions/transcripts.

## Heap snapshot dominators and reachability

The detached 300-child V8-format JSC snapshot contains 451,914 nodes and 141,273,385 bytes total node self-size. Only 438,878 nodes / 61,981,694 bytes are reachable from the synthetic root. The 79.3 MiB difference consists of unreachable nodes still present in JSC's snapshot/page inventory. Most 256 KiB `Probe*` payload strings are in that unreachable set.

Top reachable runtime constructors by self-size are module/JIT infrastructure, not child sessions: `ModuleRecord` 18,150,478 B (1,903), `FunctionCodeBlock` 5,902,102 B, `FunctionExecutable` 4,760,192 B, generic `Object` 3,296,861 B, `ModuleProgramCodeBlock` 2,928,756 B, `Structure` 2,759,648 B, and `JSLexicalEnvironment` 2,523,296 B. These are largely one-time Bun/JSC module and code costs.

After detach the reachable application objects include only 2 `AgentSession` instances (1,442 B shallow total), 2 corresponding `SessionManager` instances (864 B), and 3 `RawSseDebugBuffer` instances (336 B; one is the module-global fallback). A root path for the two edge survivors is:

`GC roots → FunctionCodeBlock → JSModuleEnvironment → probe WeakRef[] → WeakRef[0|299] → AgentSession → probeIrcHistory → sliced string → 256 KiB base string`

This is probe lexical-loop liveness (first/last iteration), bounded at two, not an OMP N-slope. No root path exists for payloads from the other 298 children.

## Exact production retaining paths

1. **Live/idle child (expected, dominant while live):**
   `AgentRegistry.#refs` (`packages/coding-agent/src/registry/agent-registry.ts`, `register`) → `AgentRef.session` → `AgentSession` → agent state/messages and session-owned debug data. `resolveRawSseDebugBuffer(owner)` attaches `RawSseDebugBuffer` to the owner; its `#records` is capped at 1,000 events and 512,000 chars in `src/debug/raw-sse-buffer.ts`.
2. **Cold park (verified release):**
   `AgentLifecycleManager.park/#park` (`src/registry/agent-lifecycle.ts`) disposes the child, calls `AgentRegistry.detachSession`, clears its subscription/timer, and leaves only `AgentRef`, `sessionFile`, and the adopted revive closure. Measured reachable slope is 6.5–7.4 KiB/child.
3. **Hub selected preview (bounded contract, sibling fix already in flight):**
   `AgentHubOverlayComponent.#transcriptCache.entries` and `#chatLog.children` in `src/modes/components/agent-hub.ts`; `PREVIEW_MAX_ENTRIES = 200`. Selection switches clear `#transcriptCache`; full disposal clears transcript materialization, external-order state, timers/subscriptions/watchers. `#externalOrder` is pruned against current peer IDs. Do not duplicate that work.
4. **Transcript finalized projection (remaining high-value suspect, primarily render/CPU plus retained cache):**
   `TranscriptContainer.render` → `#usableHistoryPrefix(width, childCount)` in `src/modes/components/transcript-container.ts` scans cached finalized segment/version state whenever descendant `AssistantMessage` calls root `requestComponentRender`. The cache is reachable for the lifetime of the parent transcript. This probe did not prove an unbounded byte leak there, but it is the only identified path that can repeatedly scan/materialize a large finalized parent history during animation/update churn.
5. **Completed job delivery:** `TaskTool` background registration in `src/tools/task/index.ts` returns `deliveryText`; session delivery persists it in the parent transcript. `JobTool.execute` in `src/tools/job.ts` calls `acknowledgeDeliveries` for non-running jobs, so the job manager is not an additional permanent full-result owner after acknowledgement. The parent transcript remains the intended durable owner.

## Diagnosis

The measured 30+ GiB live-process footprint cannot be explained by parked child reachability in the current tree. Real cold park removes 97.5% of per-child reachable heap slope, WeakRefs clear for 297/300 sessions, and the detached snapshot has no root path to those payloads. Meanwhile RSS remains ~0.81–0.85 MiB/child in the isolated benchmark and transient preview allocations raise RSS without raising post-GC heap. This is JSC heap-region/high-water retention after allocation churn, amplified by the peak number and size of simultaneously live sessions/materialized transcripts. It is not default malloc/libghostty retention.

This does not prove that Arthur's entire 31.8 GiB footprint is unreachable: the live process can still have genuinely live root-session transcript/cache objects. It proves that RSS/vmmap alone cannot distinguish them and that parked child sessions in the tested lifecycle are released.

## Prioritized fixes

1. **Bound peak live children, not only parked state.** Admission should cap concurrent live subagents; cold park immediately at completion. This directly reduces the JSC high-water mark. Existing cold park behavior is effective and should remain.
2. **Finish and verify Hub disposal/selection cleanup** under the decided contract: exactly one ≤200-entry selected preview while visible; zero preview entries/materialized chat components/subscriptions/watchers after close; previous preview released immediately on selection change. The sibling lifecycle work owns this.
3. **Make transcript dirtiness segment-local.** Avoid routing every `AssistantMessage` animation/content update to root `TranscriptContainer.render`; add a child/segment dirty API so finalized prefix versions are neither scanned nor rebuilt for a mutable-tail update. Gate this on a focused scan-count and heap benchmark; no production edit was made here because this probe proved repeated reachability/scanning, not an unbounded object leak.
4. **Avoid large transient preview strings.** Parse only the bounded tail and do not rebuild full-text intermediates on selection churn. This reduces page high-water even when all objects are later collected.
5. **Operational mitigation:** recycle the Bun process after extreme fan-out until JSC returns/compacts old heap regions more aggressively. Track both reachable heap (snapshot/WeakRef) and physical footprint; never declare success from RSS alone.

No production file was edited: no precise new single-file strong leak was proven. The evidence instead identifies JSC page retention plus bounded live-owner paths and a transcript projection optimization target.
