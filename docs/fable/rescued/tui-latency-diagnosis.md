> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-11T02-43-53-887Z_019f4f0f-599f-7000-827a-cb4f1ffded60/local/tui-latency-diagnosis.md

# OMP TUI latency diagnosis

## Scope and evidence

Diagnosis only; no production files changed. Evidence combines the read-only 4.167 s / 1 ms sample of live pid 32263 (`/tmp/omp-sample-32263.txt`) with local Bun microprobes against the current source tree. The sample reports a **5.9 GB physical footprint, 8.3 GB peak** (lines 18–19), materially worse than the earlier 965 MB RSS snapshot. Of 4,167 main-thread samples, **3,311 (79.5%) were in `kevent64`** and 856 (20.5%) were executing runtime/JIT/native work. Thus the process is not continuously spinning while idle; the failure is bursty work/latency under interaction.

Probe commands:

- `bun /tmp/tui-render-probe.ts` from `vendor/oh-my-pi`: warm full transcript and viewport-tail renders for 100/1k/5k/10k children, 100 iterations each.
- `bun /tmp/jsonl-probe.ts`: JSON stringify plus the real `FileSessionStorageWriter.append` (`Buffer.from` + `fs.writeSync`) at 1 KB–1 MB, 200 iterations each.

These isolate CPU costs and do not reproduce the full 338-agent session end-to-end; absolute live keystroke latency therefore remains unmeasured. Rankings distinguish observed facts from source-based inference.

## Ranked causes

### 1. Heap size / retained session and subagent state amplifies burst latency — HIGH confidence

**Measured evidence.** Live footprint is 5.9 GB (8.3 GB peak), not merely the 17 MB parent JSONL. The sample contains the JSC libpas scavenger and three heap-helper threads, but they are overwhelmingly waiting during this idle window; it does **not** prove an active stop-the-world pause. Still, multi-GB live state makes occasional marking/scavenging and allocation bursts the best explanation for beachball-like interaction stalls that disappear from an idle sample. The earlier process accounting (main utime 43:36 over 3h53m, ≈18.7% average core, reaching 100% during interaction) corroborates bursty CPU.

**Exact code.** Transcript retention is explicit in `packages/coding-agent/src/modes/components/transcript-container.ts`, `TranscriptContainer.render` (around lines 755–900), which preserves assembled rows and one segment per child. TUI also preserves complete composed/prepared frames and segment ledgers in `packages/tui/src/tui.ts`, `TUI.#composedFrame`, `#frameSegments`, `#preparedFrame`, `#preparedMeta` (lines 875–913). Agent/subagent ownership is surfaced by `packages/coding-agent/src/modes/components/agent-hub.ts`, `AgentHubOverlayComponent`.

**Fix plan.** First obtain heap snapshots at idle and immediately after Agent Hub interaction and rank dominators. Then make parent process retain only bounded summaries/terminal projection for parked/completed subagents; load detailed child transcripts on demand. Bound or page finalized transcript render objects while preserving journal authority. Add RSS/heap and event-loop-lag telemetry keyed to `LoopWatchdog` phase.

### 2. O(history) frame bookkeeping and broad invalidation during interactive bursts — MEDIUM-HIGH confidence

**Measured evidence.** Current optimized warm `TranscriptContainer.render(100)` scales with child count: 100 children p50/p95 **0.012/0.043 ms**; 1k **0.058/0.214 ms**; 5k **0.225/0.434 ms**; 10k **0.312/0.715 ms**. `renderViewportTail(100,40)` stays essentially flat: at 10k children **0.004/0.007 ms**. This refutes “markdown/full transcript recomputation on every ordinary frame” in the current tree, but confirms unavoidable linear pointer/segment walks. At animation/event-storm rates and with complex mutable markdown/tool blocks, preparation, diffing, terminal writes, and GC can multiply this small synthetic cost. The retained metrics at 10k were 19,999 assembled rows, 10k segments, 30k raw row refs, and 10k contribution refs.

Scheduler source already coalesces to 30 Hz (`TUI.#MIN_RENDER_INTERVAL_MS`, `packages/tui/src/tui.ts:707–717`) and supports component-scoped rendering (`#componentRenderTargets`, `#partialComposeRoots`, lines 888–901). Existing regression evidence in `packages/tui/test/tui.test.ts:71–88` asserts 1,000 invalidations/render requests coalesce to one scheduled paint. Therefore suspect 1 is **partially refuted** as originally phrased: not every event causes a paint, and warm finalized history is cached. The remaining risk is callers using global `invalidate()`/`requestRender()` rather than `requestComponentRender`, forcing prefix audits/preparation.

**Fix plan.** Instrument `TUI.#doRender` by phase (compose, prepare, audit, diff, write), recording rows visited/bytes written and request source. Convert all spinner/blink/live-tool callers to component-scoped requests. Maintain dirty root/range indexes so ordinary input never scans committed history; keep viewport-tail composition for transient resize/fullscreen paths. Enforce a single frame budget and drop superseded animations when watchdog lag rises.

### 3. Agent Hub roster/chat derived-state rebuilding is likely O(N), but not established as primary — MEDIUM confidence

**Source evidence.** `AgentHubOverlayComponent.render` dispatches to `#renderTable`/`#renderChat` (`packages/coding-agent/src/modes/components/agent-hub.ts:702–703`). `#renderTable` computes status summary, total rows and visible rows around lines 1238–1289; chat rendering builds content/search state around 1755–1787. With 338 agents, repeated filtering/tree flattening/status counting is an O(N) candidate. However the overlay renders a bounded viewport, and no measured Agent Hub constructor fixture was safely available in the time-box; there is no numerical proof that 338 rows alone causes the beachball. Treat event fan-in / registry notifications as the likely multiplier, not raw row painting.

**Fix plan.** Add a deterministic benchmark around `AgentHubOverlayComponent` with real `AgentRegistry` records at N=0/50/100/338/1,000 and measure registry event → paint completion. Cache status counts and flattened tree by registry generation; update incrementally on one agent transition. Virtualize table/chat rows and debounce registry/IRC notifications into one immutable snapshot per frame. Ensure closed/parked child detail transcripts are not resident merely to show roster summaries.

## Refuted / lower-ranked suspects

### Session JSONL append/fsync — LOW

The hot path is synchronous but append-only: `SessionManager.#appendToSessionFile` (`packages/coding-agent/src/session/session-manager.ts:710–742`) calls `#lineFor` then `FileSessionStorageWriter.append`. The writer performs `Buffer.from` and `fs.writeSync` with **no fsync** (`packages/coding-agent/src/session/session-storage.ts:59–106`). Measured stringify+real append: 1 KB p50/p95/max **0.003/0.010/0.118 ms**; 10 KB **0.009/0.028/0.085 ms**; 100 KB **0.041/0.111/0.891 ms**; 1 MB **0.264/1.695/13.902 ms**. Normal events are not large enough for this to explain seconds-long stalls. Cold/divergent and Ctrl+C paths can rewrite the whole journal synchronously via `SessionManager.#rewriteSynchronously` / `#fileBody` (lines 646–680), but those are not the normal interaction hot path. Fix only after profiling: move serialization/write off the UI turn while preserving durability semantics, and never perform whole-file rewrite during input handling.

### IRC/system-notice storm — UNCONFIRMED multiplier

Scheduler coalescing means a storm does not imply one paint per event. It may still allocate and synchronously update many view models before the coalesced paint. Instrument event counts and handler wall time by event type before changing semantics; batch registry/IRC projection once per event-loop turn.

## Top three fixes

1. **Bound parent-process retention:** lazy-load parked/completed subagent detail transcripts; page finalized transcript render objects; verify with heap dominators and RSS before/after.
2. **Make rendering dirty-range/component scoped end-to-end:** phase-time `TUI.#doRender`, eliminate global invalidations from animation/event paths, and avoid committed-history scans/writes on keystrokes.
3. **Incremental Agent Hub projection:** generation-cached counts/tree, viewport virtualization, and one batched registry/IRC snapshot per frame.

## Bottom line

The available measurements refute synchronous JSONL append and naïve “one full paint per event” as dominant causes in the current tree. The strongest live anomaly is the **5.9 GB footprint (8.3 GB peak)**. The most plausible mechanism is multi-GB retained parent/subagent state causing allocation/GC and broad projection work to become bursty under interaction, with O(history) render bookkeeping and O(agent) Hub/event projection as amplifiers. A live interaction trace with watchdog phase timings and heap dominators is the decisive next measurement.
