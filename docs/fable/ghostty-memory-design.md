# Ghostty memory design

> **Status:** proposal — commissioned by Arthur 2026-07-15  
> **Author lane:** GhosttyPagingResearch  
> **Cross-references:** `harness-runtime-contract.md`; `fleet-rollout-design.md` HR-115; `runtime-policy-design.md` HR-129

## Verdict

Do not vendor whole Ghostty/libghostty-vt and do not bind terminal-specific APIs for OMP. Adapt the architecture in OMP with an independent codec/page format. Ghostty’s resident/compressed page union is a strong architectural precedent, but its terminal-specific C/Zig API is not a generic transcript codec and its public Zig API is explicitly unstable.

The OMP MVP should have the Runner own append-only journal authority and a mutable hot tail; seal fixed-size immutable pages of approximately 256 KiB–1 MiB; hydrate pages asynchronously for view/search; keep a bounded LRU view cache; and use idle, bounded compression passes without blocking the runner. Keep a helper process as a later escape hatch if native codec crashes or latency demand requires it.

## Measured OMP evidence

Carry this observed fleet evidence verbatim: **113 OMP+MCP processes use 8.69 GiB RSS; current Main 1.75 GiB; browser fleet separately 13.4 GiB; cold-park landed but process recycle remains only reliable JSC page-return lever.**

The architecture must measure peak and steady RSS, JSC heap/external bytes, compressed ratio, page count/encoded bytes, hydrate latency p50/p95/p99, append throughput, and TUI frame latency under sustained writes. Compressing serialized bytes alone cannot claim to reclaim the live JSC graph.

## Ghostty PR and release status

PR #13264 is merged/closed 2026-07-09: merge commit `7e02af87980bfdaad6d393b985d35c917476878e`, PR head `9a4bd2120a56073435c45c5249144817b400019a`; merge commit’s first parent/base is `11b9a6ef17e21b89e2ef14dd786992cc5577b69b` (GitHub PR API now shows moving base `7cb44fe`). Main’s latest nightly tag is tip `55a3e33` (2026-07-13); stable tags list stops at `v1.3.1`, so treat this as post-v1.3.1/nightly rather than stable release. Ghostty is MIT licensed.

## Exact source and permalink table

| Evidence | Exact source |
|---|---|
| PageList resident/compressed union, metadata-only access, and content restore | https://github.com/ghostty-org/ghostty/blob/9a4bd2120a56073435c45c5249144817b400019a/src/terminal/PageList.zig#L54-L107 |
| Preserved clone and metadata access | https://github.com/ghostty-org/ghostty/blob/9a4bd2120a56073435c45c5249144817b400019a/src/terminal/PageList.zig#L110-L230 |
| Recommit/decode/discard restore boundary | https://github.com/ghostty-org/ghostty/blob/9a4bd2120a56073435c45c5249144817b400019a/src/terminal/PageList.zig#L234-L292 |
| Pin semantics: stable page/x/y coordinate, tracked pin updates, garbage | https://github.com/ghostty-org/ghostty/blob/9a4bd2120a56073435c45c5249144817b400019a/src/terminal/PageList.zig#L5965-L6038 |
| Compression state, cold iterator, bounded inspection, verification pass, and strict decommit | https://github.com/ghostty-org/ghostty/blob/9a4bd2120a56073435c45c5249144817b400019a/src/terminal/PageList.zig#L3803-L4204 |
| `MemoryStats` logical raw bytes, decommitted bytes, encoded bytes, and estimated savings | https://github.com/ghostty-org/ghostty/blob/9a4bd2120a56073435c45c5249144817b400019a/src/terminal/PageList.zig#L5840-L5943 |
| Compressed Page metadata, retained mapping, exact encoded LZ4 allocation, scratch profitability, deinit, and restore | https://github.com/ghostty-org/ghostty/blob/9a4bd2120a56073435c45c5249144817b400019a/src/terminal/compress/Page.zig#L1-L148 and #L149-L220 |
| Linux/Darwin memory advice and retained virtual address | https://github.com/ghostty-org/ghostty/blob/9a4bd2120a56073435c45c5249144817b400019a/src/terminal/mem.zig#L34-L138 and https://github.com/ghostty-org/ghostty/blob/9a4bd2120a56073435c45c5249144817b400019a/src/terminal/mem.zig#L139-L180 |
| Renderer 250 ms idle delay, opaque activity token, `tryLock`, 1 ms continuation, and contention retry | https://github.com/ghostty-org/ghostty/blob/9a4bd2120a56073435c45c5249144817b400019a/src/renderer/Thread.zig#L757-L875 |
| Terminal compression methods | https://github.com/ghostty-org/ghostty/blob/9a4bd2120a56073435c45c5249144817b400019a/src/terminal/Terminal.zig#L2297-L2378 |
| C API declarations | https://github.com/ghostty-org/ghostty/blob/9a4bd2120a56073435c45c5249144817b400019a/include/ghostty/vt/terminal.h#L40-L55 and #L1204-L1263 |
| C wrappers | https://github.com/ghostty-org/ghostty/blob/9a4bd2120a56073435c45c5249144817b400019a/src/terminal/c/terminal.zig#L324-L345 |
| Public Zig API stability warning | https://github.com/ghostty-org/ghostty/blob/9a4bd2120a56073435c45c5249144817b400019a/src/lib_vt.zig#L1-L10 |
| Internal LZ4 codec | https://github.com/ghostty-org/ghostty/blob/9a4bd2120a56073435c45c5249144817b400019a/src/terminal/compress/lz4.zig#L1-L110 and #L260-L340 |
| Differential codec tests | https://github.com/ghostty-org/ghostty/blob/9a4bd2120a56073435c45c5249144817b400019a/src/terminal/compress/lz4_differential.zig#L1-L25 and #L190-L260 and #L300-L360 and #L430-L494 |

## libghostty-vt exact APIs

The terminal API exposes:

```zig
pub fn compressionActivity(self: *const Terminal) u64
pub fn compress(self: *Terminal, mode: CompressionMode) CompressionResult
```

Source: https://github.com/ghostty-org/ghostty/blob/9a4bd2120a56073435c45c5249144817b400019a/src/terminal/Terminal.zig#L2297-L2378

The C declarations are exactly:

```c
GHOSTTY_API GhosttyResult ghostty_terminal_compression_activity(
    GhosttyTerminal terminal,
    uint64_t* out_activity
);

GHOSTTY_API GhosttyResult ghostty_terminal_compress(
    GhosttyTerminal terminal,
    GhosttyTerminalCompressionMode mode,
    GhosttyTerminalCompressionResult* out_result
);
```

Source: https://github.com/ghostty-org/ghostty/blob/9a4bd2120a56073435c45c5249144817b400019a/include/ghostty/vt/terminal.h#L40-L55 and #L1204-L1263; wrappers: https://github.com/ghostty-org/ghostty/blob/9a4bd2120a56073435c45c5249144817b400019a/src/terminal/c/terminal.zig#L324-L345.

The API is caller-driven: no timer/background thread; it reports pending/complete/unsupported; serialization is required; content access restores. `lib_vt.zig` warns that the Zig API is not stable and functions/types can change without warning: https://github.com/ghostty-org/ghostty/blob/9a4bd2120a56073435c45c5249144817b400019a/src/lib_vt.zig#L1-L10.

`lz4.zig` is an internal allocation-free raw-block codec, not an exported generic libghostty-vt API. Its exact signatures are:

```zig
pub fn compress(input: []const u8, output: []u8, table: *HashTable) CompressError!usize
pub fn decompress(input: []const u8, output: []u8) DecompressError!usize
pub fn compressBound(input_len: usize) CompressError!usize
```

Source: https://github.com/ghostty-org/ghostty/blob/9a4bd2120a56073435c45c5249144817b400019a/src/terminal/compress/lz4.zig#L1-L110 and #L260-L340.

No explicit C recompression-required boolean was found; source uses an activity token plus a verification pass. PR prose says decompression triggers recompression-required flags, but the exposed API only provides an opaque activity token, so treat that prose as imprecise/forward-looking.

## What transfers and what does not

Transfer the principles:

- immutable page union with resident and compressed representations;
- metadata-only index access;
- stable IDs and coordinates/pointers for access;
- transparent hydrate and restore;
- bounded idle passes and activity tokens;
- verification/recompression after pages are restored or mutated;
- explicit memory accounting and cold-page reclamation.

Do not transfer terminal-specific page schemas, terminal C APIs, or the assumption that compressing serialized bytes alone frees arbitrary JSC object graphs. OMP needs a page schema built around durable journal entries and stable entry IDs. The Runner remains journal authority; the View/TUI consumes journal snapshots/projections and never owns persistence.

## OMP retention evidence

SessionManager is an append-only JSONL/tree journal with in-memory `#entries: SessionEntry[]` and `SessionEntryIndex` maps/sets/children/leaf/usage kept in lockstep. Append serializes JSON lines and writes synchronously; `buildSessionContext`/`getEntries` derive from in-memory entries:

- https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/session/session-manager.ts#L145-L234
- https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/session/session-manager.ts#L443-L530
- https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/session/session-manager.ts#L648-L787
- https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/session/session-manager.ts#L873-L905
- https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/session/session-manager.ts#L1518-L1550
- https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/session/session-manager.ts#L2030-L2068

Journal projection decodes JSONL and supports a 256 KiB bounded tail plus asynchronous tail reads: https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/journal/projection.ts#L1-L88.

AgentSession repeatedly reads mutable `agent.state.messages` arrays: https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/session/agent-session.ts#L1478-L1490 and #L1622-L1635.

Therefore, compressing serialized bytes alone cannot free the JSC graph: references in `Agent.state.messages`, `SessionManager.#entries`, index maps, TUI projections, and tool-result objects must first be replaced or dropped. OMP must page ownership-bearing representations, not merely add a compressed copy beside live objects.

## Interop ranking

1. **Pure TypeScript fixed-page serialization first.** No ABI, package, or native-crash risk. Same-process typed-array ownership can be dropped, but CPU cost must be measured.
2. **N-API Rust codec second if pure TypeScript misses latency.** This is the most stable Bun boundary and OMP already has `@oh-my-pi/pi-natives` packaging, but an in-process native crash still kills OMP.
3. **Bun FFI only as experimental/prototype.** Zig works, but ABI/manual-memory/pointer-lifetime hazards remain and there is no async FFI. Official docs: https://bun.sh/docs/runtime/ffi.
4. **Helper process last or when isolation is required.** It provides strong crash containment, but IPC copies unless mmap/shared memory is used, with packaging and recovery complexity. Bun child-process docs: https://bun.sh/docs/runtime/child-process.
5. **Worker is a scheduling aid, not isolation.** Workers are separate JS instances on a separate thread but remain in-process; messages use structured clone and `smol:true` only shrinks the JSC heap. Source: https://bun.sh/docs/runtime/workers.

Node-API is the most stable Bun native boundary and loads `.node` via `require`/`process.dlopen`: https://bun.sh/docs/runtime/node-api. OMP already has native Rust/N-API package `@oh-my-pi/pi-natives` v16.0.1 with `@napi-rs/cli`, platform `native/index.js` plus `index.d.ts`, MIT: `vendor/oh-my-pi/packages/natives/package.json#L1-L65`.

## Definition of done: page architecture

The MVP architecture is:

- Runner owns append-only journal authority and the mutable hot tail.
- Runner seals fixed-size immutable pages, approximately 256 KiB–1 MiB, containing version, sequence range, byte length, checksum, and entry-ID offsets.
- Only sealed pages outside the hot viewport are compression candidates.
- A resident/compressed union stores encoded bytes plus metadata and drops resident decoded objects when cold.
- View/search hydrates pages asynchronously.
- Mutation marks a page dirty and recompression-required.
- View state uses a bounded LRU cache.
- Compression uses an activity token, a 250 ms quiet delay, one-page/max-byte steps, and no blocking on the Runner.
- Cold pages are reclaimed/recycled when measured RSS stays above threshold.
- View/TUI consumes journal snapshots/projections and stable IDs; it never owns persistence.
- A helper process remains a later escape hatch if native codec crashes or latency demand requires it.

## Cold recycle

Cold-park can release child processes, but process recycle remains the only reliable JSC page-return lever in the observed OMP fleet. The page design should therefore first reduce the live object graph by dropping resident decoded objects, then use measured RSS thresholds to reclaim/recycle cold pages. It must not promise that compression alone returns JSC pages to the operating system.

Ghostty’s own scheduling behavior is deliberately non-blocking: the renderer schedules a 250 ms idle delay, compares an opaque activity token, uses `tryLock` rather than blocking I/O, continues in 1 ms steps while pending, and retries after contention at 250 ms. Sustained I/O can therefore defer compression and allow RSS to balloon in favor of throughput. Source: https://github.com/ghostty-org/ghostty/blob/9a4bd2120a56073435c45c5249144817b400019a/src/renderer/Thread.zig#L757-L875.

## Benchmark acceptance

Benchmark baseline versus paging on synthetic and real journals at 1/10/50/100+ MiB and 8/32/113 sessions. Record:

- peak and steady RSS;
- JSC heap and external bytes;
- compressed ratio;
- page count and encoded bytes;
- hydrate latency p50/p95/p99;
- append throughput;
- TUI frame latency under sustained writes;
- no data loss after hydrate/recompress/process crash/reload.

Acceptance proposal:

- at least 30% fleet RSS reduction at 50 MiB+ cold history, with a target of at least 50%;
- p95 hydrate ≤50 ms and p99 ≤150 ms for one page;
- append throughput ≥98% of baseline and no visible frame drops;
- checksum/entry-ID recovery 100% across randomized paging/restart;
- compression-disabled/unsupported behavior is identical to the baseline.

## Risks and evidence limits

Ghostty’s codec source has an independent block walker, exact-size round-trip, wrong-size rejection, bit flips/byte overwrites/splices/truncation mutation safety, deterministic generators (random/runs/periodic/cell-like/words/sparse/mixed), and an exhaustive environment-gated suite: https://github.com/ghostty-org/ghostty/blob/9a4bd2120a56073435c45c5249144817b400019a/src/terminal/compress/lz4_differential.zig#L1-L25 and #L190-L260 and #L300-L360 and #L430-L494. The PR’s lone comment says a larger differential/fuzzing corpus was still desired; do not call it production-fuzz-proven.

The research attempt `GHOSTTY_LZ4_SLOW=1 zig build test-lib-vt` in the clone timed out at 180 seconds; source-level test coverage is definitive, while prior research context reported filtered/full lib-vt tests passing. Bun FFI remains experimental with known bugs. Native in-process codecs retain crash blast radius. Helper-process isolation introduces copies, packaging, and recovery complexity. Compression may remain behind sustained I/O, so acceptance must include frame latency and append throughput rather than RSS alone.
