> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-11T02-43-53-887Z_019f4f0f-599f-7000-827a-cb4f1ffded60/local/fable-restart-handoff-2026-07-13.md

# Fable restart handoff — 2026-07-13

## Arthur's immediate request

Stop the broad stabilization program. Do one bounded Agent Hub UX slice:

1. Display each subagent's token generation rate clearly as `N.N tok/s`.
2. In the Agent Hub preview pane, stream the subagent's TUI-equivalent live output.
3. Omit the subagent input/editor line from that preview.
4. Verify the live behavior visually and stop.

Arthur explicitly asked for a restart with Fable as orchestrator because implementation had become too slow. All active agents were stopped/frozen. The three preview todos were dropped only to permit the restart; they are NOT implemented.

## Why the prior turn was slow

The inherited scope had expanded into a full stabilization program: default reloadable TUI cutover, staged-snapshot repair, control-plane migration, refusal lab, resume profiling, transcript retention, cmux lifecycle, and worker-process architecture. Coordination and non-hermetic dirty-tree work dominated visible UX delivery. Two worker-pool agents also stopped at an echo-only primitive rather than extracting the actual TaskTool execution contract. This was the wrong prioritization for Arthur's immediate request.

## Agent Hub seams already located

Primary file:

- `vendor/oh-my-pi/packages/coding-agent/src/modes/components/agent-hub.ts`

Relevant current behavior:

- `#renderPreview` / `#renderTranscriptPreview` at approximately lines 1277–1342 render the selected child transcript through the real transcript components.
- `#renderTranscriptPreview` currently adds `this.#editor.render(...)` when cockpit mode is `input` (approximately lines 1326–1339). The requested preview should not render that editor/input line.
- `#buildStatsLine` at approximately lines 2326–2351 currently shows context, duration, tool count, and cost, but no tok/s.
- `#appendAssistantMessage` / pending usage flow already receives assistant usage and renders usage rows.
- Existing token-rate implementation: `packages/coding-agent/src/modes/components/status-line/token-rate.ts::calculateTokensPerSecond(messages, isStreaming, nowMs)`. Reuse it; do not introduce a second formula/convention.
- Child progress contract: `packages/coding-agent/src/task/types.ts::AgentProgress` currently carries cumulative tokens/context/cost/duration but no precise generation-rate field.
- Subagents are normally headless AgentSessions, not independent InteractiveMode PTYs. Treat “stream the TUI” as the same live transcript/tool/status component projection the child would render, not a fabricated terminal byte stream. If Arthur means a literal child PTY, state that architectural fact before building a new process surface.

Likely bounded implementation:

- Feed the selected child's live assistant-message stream into the existing `calculateTokensPerSecond` helper.
- Render a high-contrast `N.N tok/s` badge in the preview header and/or selected roster stats; avoid cumulative `tokens / wall time`, which is not generation throughput.
- Keep the preview transcript/tool/status streaming path; remove only the editor/input rows from the preview pane. Preserve message composition through the explicit chat/input surface if still needed outside preview.
- Add focused Agent Hub tests for live tok/s update, zero/insufficient-duration omission, preview streaming on journal updates, and editor-line exclusion.
- Run visual PTY proof at a realistic terminal size. Do not restart cmux/worker-pool work.

## Verified checkpoints landed this turn

- `cee905d2` — production-shaped semantic tail/tool-reflow regression; staged TUI typecheck; 2 focused tests.
- `c2d4572b` — ordinary `omp` now uses the full rich reloadable SessionRunner + DisposableTerminalHost path; compact remains non-default; staged typecheck, 60 pass/1 skip, phase-two 7/7, Darwin PTY same PID/session and termios restoration.
- `2f54cb1d` — local redacted refusal JSONL corpus and `omp refusals` CLI; staged gate, 8 tests.
- `e462ecc6` — resume journal decoded once; copied 19.8 MB/10,333-record journal parse median 75.20→39.35 ms; createSessionManager 155→106–114 ms; 35 tests.
- `4bbd655a` — bounded transcript/Hub retention, push invalidation, Hub-close cleanup, u/d paging, wide gutter; staged gate, 68 tests.
- `2c59230e` + corrective `da35f954` — selective Phase3A operational evidence projection; isolated typecheck and 21 tests/273 assertions. The corrective removed duplicated ledger helpers caught by typecheck.
- `920e8ffa`, `368c7e7a` — request register/friction/refusal workflow synchronized with verified checkpoints.
- Separate dotfiles repo commit `7387d2a8` — cmux close confirmation and Cmd+D,W chord.

## Stable binary state

Latest blessed immutable binary remains the earlier digest:

- `74dac97b40deba870ecd07fcd757954c8bd73912e076dd23312e64be62778eb1`
- version `16.0.1+fork.b3607b747c2d`

The new checkpoints above were NOT promoted. Do not claim Arthur's installed `omp` contains them until a new isolated readiness proof and immutable promotion complete.

## Unsafe/incomplete uncommitted slices — do not ship

### cmux / agent-mux

After the freeze request, `CmuxDetachFinal` reported that it had already finished edits closing all nine review findings, including the authenticated pre-journal reservation handshake and cleanup after initial state write, ownership/running-state write, and listen failures. Cleanup uses bounded TERM/KILL and removes lease, socket, and reservation state. Agent-reported proof: 25 mux regressions, 17 OMP ownership tests, shell syntax, and `packages/agent-mux/test/.tmp/live-detach-reattach-proof.json` with stable daemon/child PIDs `58153`/`58156`, tick `1→4`, preserved session/replay, and both processes dead after kill. Full focused output: `artifact://4562`; no-orphan proof: `artifact://4564`. This landed after Main's verification window: it remains uncommitted and independently unverified. Preserve it, but do not claim or ship it until the restarted orchestrator re-runs the focused tests, inspects the proof, obtains review, and checkpoints the selective manifest.

### subagent worker pool

Uncommitted files exist under:

- `packages/coding-agent/src/task/subagent-worker-{protocol,pool,entry}.ts`
- `packages/coding-agent/test/task/subagent-worker-pool.test.ts`
- `packages/coding-agent/scripts/prove-subagent-worker-pool.ts`

They implement only a real-process echo/delay/allocation/crash primitive. They do NOT use Effect Schema, do NOT run a provider/tool turn, do NOT integrate `TaskTool`/`executor.ts`, and do NOT preserve real coordinator RPC/journal semantics. Never present them as the worker-pool feature. `WorkerTurnExtractionPlan` completed a read-only extraction plan in `agent://WorkerTurnExtractionPlan`: the real cutover must reuse `session/durable-input-queue.ts` (`admitNext`, `markRunning`, `completeAttempt` / `failRateLimit` / `requeueUnstarted`, and `ownerEpoch`) plus AgentSession's durable attempt markers—never create a parallel task queue. The SDK construction seam is `sdk.ts::createAgentSession` (around line 1129); the provider boundary is its `new Agent` / `streamFn` composition (around lines 2507/2552). Either delete the incomplete primitive later or execute that full contract extraction.

## Dirty-tree warning

No staged changes were left by Main. The outer tree is extremely dirty from concurrent/user work: the latest observed status reported 1,215 unstaged and 952 untracked paths. Preserve all unrelated work. Use staged-snapshot verification for every checkpoint; working-tree green results are not trustworthy here.

## Orchestration directive for the restarted session

Fable owns intent and the UI ontology. Keep the next slice single-purpose. Use Luna xhigh for the bounded Agent Hub edit/tests/visual runbook. Do not revive cmux, worker-pool, promotion, or broad ledger work until the preview request is working and Arthur has reviewed it.
