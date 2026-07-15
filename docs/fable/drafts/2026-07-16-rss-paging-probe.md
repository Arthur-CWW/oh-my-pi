# HR-133 RSS paging design probe

Status: design probe only; no implementation claim. Measured 2026-07-15 UTC on macOS.

## Measurement

Method:

1. Ran read-only `omp fleet status`, then `omp fleet status --all` because the fresh view had no explicit idle main-runner row.
2. Treated fleet states `idle` and `waiting_input` as idle, joined their session UUIDs to live OMP command lines, and sampled the matched PIDs with `ps`.
3. Ran bounded `vmmap -summary` parsing for one matched idle runner; no raw map was retained.

At 2026-07-15T16:18:16Z:

| Fleet session / state | PID | ps RSS | ps state / CPU | Age |
|---|---:|---:|---:|---:|
| `019f644d…a4fb`, `idle` | 68651 | 314,912 KiB (307.5 MiB) | S+ / 13.9% | 10:34:13 |
| `019f6426…73b9`, `waiting_input` | 94699 | 218,400 KiB (213.3 MiB) | S+ / 1.4% | 02:48:22 |
| `019f6141…db5d`, `waiting_input` | 38252 | 164,368 KiB (160.5 MiB) | S+ / 8.9% | 12:01:34 |

The three idle processes held 681.3 MiB RSS in this sample. Fleet records were stale even though all three OS processes were alive; idle detection/heartbeat freshness is itself an observability gap. `%CPU` is `ps`'s process average, not an instantaneous idle assertion.

This snapshot did not reproduce a multi-GiB single idle runner; it confirms a persistent hundreds-of-MiB floor. The register's earlier 1.75 GiB Main measurement remains the large-session incident baseline.

Bounded `vmmap -summary` for idle PID 68651:

- Physical footprint 425.1 MiB; peak 475.8 MiB.
- Writable regions: 89.1 MiB resident and 334.7 MiB swapped from 391.6 MiB written.
- Largest private allocator region: `WebKit Malloc`, 74.9 MiB resident / 74.6 MiB dirty / 220.3 MiB swapped (708.3 MiB virtual). This is the strongest process-level evidence that the JSC/Bun object graph is the reclaimable holder.
- Largest resident mappings were shareable binary/library pages: `__LINKEDIT` 378.5 MiB and `__TEXT` 369.3 MiB; `__BUN` was 42.2 MiB. These are not transcript pages and should not be charged as fully private savings.
- `ps` RSS, physical footprint, and region-resident totals are not additive: macOS accounts shared mappings, compressed memory, and swap differently.

Conclusion: the reducible target is principally JSC allocator state, but `vmmap` cannot distinguish message history from tool/model/eval objects. The current evidence does **not** justify claiming transcript history alone dominates. A heap snapshot/object-retainer census is needed to split `WebKit Malloc`; code growth characteristics below make transcript/journal projections the first candidates and registries secondary candidates.

## Narrow code map

- The durable journal is eagerly projected twice: `SessionManager` retains the full `#entries` array plus `SessionEntryIndex` maps/sets/children (`packages/coding-agent/src/session/session-manager.ts:161-172,494-508`). `buildSessionContext` resolves from that full projection (`:2082-2083`). Indexes mostly retain the same entry objects, but add per-entry map/set/array overhead.
- Resume eagerly builds context and branch (`packages/coding-agent/src/sdk.ts:1257-1261`) and copies resolved messages into the live agent (`:2569-2570`). `AgentState.messages` is a full `AgentMessage[]` (`packages/agent/src/types.ts:432-435`); construction and replacement deliberately copy the array (`packages/agent/src/agent.ts:372-373,735-738`). This scales with transcript/tool-result payload count.
- Durable input and live IRC are separate state that cold paging must not discard: `AgentSession` owns a durable input queue promise (`packages/coding-agent/src/session/agent-session.ts:1236-1240`) and pending streaming IRC asides (`:1377-1380`). Message persistence happens at `:2846-2855`.
- `ModelRegistry` is normally created per SDK session (`packages/coding-agent/src/sdk.ts:1145-1149`) and retains model arrays, canonical indexes, overrides, discovery states, caches, and runtime provider maps (`packages/coding-agent/src/config/model-registry.ts:623-651`). It scales with catalog/provider count, not transcript length, so it is likely bounded but not free.
- The tool registry wraps every built-in/extension tool and retains schemas/closures (`packages/coding-agent/src/sdk.ts:2074-2110`). `AgentSession` additionally retains the registry, discoverable MCP map, selected-name sets, and a lazy BM25 search index (`packages/coding-agent/src/session/agent-session.ts:1409-1443,4731-4734`). This scales with tool count and may retain extension/MCP clients.
- Existing disposal already closes strong secondary holders: eval kernels/VM contexts, browsers, provider sessions, and the journal manager (`packages/coding-agent/src/session/agent-session.ts:4342-4361`). Reuse this lifecycle rather than inventing partial cleanup.
- Restart already supports lease retirement followed by same-PID `execve`, preserving PTY/tmux ownership (`packages/coding-agent/src/cli/restart-session.ts:252-263`). It is a useful purge primitive, but it only saves memory if the replacement boots cold instead of immediately rehydrating the full SDK session.

## Options

| Option | Sketch | Cost / risk | Required invariant |
|---|---|---|---|
| A. Same-PID cold reexec | On idle: flush/fence journal, dispose session resources, then reexec into a minimal cold shell that keeps terminal identity, session-control/IRC, fleet heartbeat, and a hot display summary. Hydrate SDK/session from journal only after input/wake. | Medium-high. Reuses proven exec/hydration paths and reliably drops the JSC heap. Hard part is a truly minimal boot path and ownership handoff; reexec followed by eager SDK construction gains little. Base Bun/shared-image RSS prevents literal zero, so measure incremental private footprint too. | Durable inputs are committed before teardown and delivered exactly once after wake; IRC wake remains reachable; heartbeat has no false death; PTY/PID identity survives. |
| B. Explicit transcript pages | Make journal entries immutable cold pages, keep a hot viewport/context window, compress older pages, and expose async hydration to transcript/branch/model-context consumers. Journal remains canonical. | Very high. Many callers assume random-access arrays and synchronous `AgentMessage[]`; tool-call/result pairing, branch changes, compaction, secrets, images, and extensions cross page boundaries. Best steady-state UX, largest refactor/data-loss risk. | Page eviction never rewrites the journal; hydrated branch is byte/ordering equivalent; tool pairs and durable-delivery IDs cannot split or duplicate; input dispatch stays responsive while loading. |
| C. Heap census + idle GC | Capture Bun/JSC heap snapshots on a saved large-session corpus, classify retainers, dispose known caches, and test explicit idle `Bun.gc(true)`/allocator behavior. | Low-medium. Essential attribution and may recover dead objects, but live history remains reachable and JSC may retain arenas. It cannot achieve near-zero alone and production snapshots can pause or expose sensitive content. | Profiling is opt-in/offline, redacted and bounded; no heartbeat/input latency regression; GC is never used as a correctness mechanism. |

## Recommendation: cold-shell feasibility canary

Take Option A as the next bounded slice, preceded inside the same canary by one offline heap census. Do not build transcript paging until a cold boot proves that unloading the whole SDK object graph meets the budget; otherwise page APIs may add complexity without removing the dominant allocation.

Acceptance criteria for one opt-in saved large-session corpus and one live canary:

1. Park flushes the journal and durable-input evidence, then same-PID reexecs into a cold mode that does not construct `SessionManager`, `ModelRegistry`, tools, provider clients, or eval kernels until wake.
2. After 60 seconds cold: ps RSS falls at least 60% from the pre-park baseline and writable dirty+swapped footprint falls at least 80%; report shared vs private bytes separately.
3. A user/IRC input receives an acknowledgement within p99 50 ms, shows explicit async hydration, reaches ready state within p99 2 s on the saved corpus, and is delivered exactly once in original durable-queue order.
4. PID/PTY identity is unchanged; fleet heartbeat misses fewer than two intervals; session-control remains addressable throughout.
5. The journal is byte-identical across park alone; after wake it only has the expected new input/output appends. Branch, selected model/tools, workflow, pending durable inputs, and visible hot tail match a no-park control.
6. Heap census reports retained bytes by messages/journal indexes/model registry/tool registry/eval or `unknown`; no product heap snapshots are enabled by default.

## Open questions

- Is `waiting_input` the canonical cold trigger, and why are live idle rows already fleet-stale? Paging must not amplify a heartbeat bug.
- Which process should own IRC/session-control and the durable queue while the SDK is absent: the cold Bun shell, or a smaller supervisor?
- Can journal ownership be retained safely through cold mode, or must it be fenced/reacquired like rollout restart?
- What transcript tail/metadata must remain renderable without hydrating secrets, image blobs, or full tool results?
- Are provider websocket, MCP, extension, eval, and browser reconnect latencies acceptable on every cold wake?
- Should the budget be ps RSS, physical footprint, private dirty+compressed bytes, or all three? Shared `__TEXT`/`__LINKEDIT` makes RSS alone misleading.
- Does a fresh compiled OMP cold shell fit the target, or is process exit plus an external supervisor required for approximately zero incremental idle cost?
