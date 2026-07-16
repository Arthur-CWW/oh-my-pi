# Detach survival design — runner daemon + disposable clients (HR-026/HR-034)

_Yielded by DetachSurvivalPlan 2026-07-16; materialized by Main from the salvaged yield (agent hit the subprocess wall after submitting)._

## Summary

Recommend design B: launch a per-session runner daemon in an independent process/session and make every terminal an independently disposable client. The current “disposable view” is only an in-process object seam; wrapping it in a socket is insufficient because the rich TUI bypasses `TerminalSessionController` and directly consumes `AgentSession`, `SessionManager`, MCP, settings, and callbacks. The design document should make that transport reality explicit, reject A as dependent on unverified cmux signal/process-group behavior, define attach/discovery/status contracts, and specify one clean-cutover implementation wave plus an HR-034 real-process proof. No files were modified and no commands/tests were run.

## Assumptions

- [OBSERVED, not source-verified] The live incident establishes that a cmux tab close delivered SIGHUP to the shared OMP process (`docs/fable/harness-request-register.md:95`).
- [UNVERIFIED] Repo-local cmux material contains configuration only (`local/dotfiles-mise-shims/shell/dot-config/cmux/cmux.json:5-10,39-42`), not close/PTY teardown source. Whether cmux also closes the PTY master, sends SIGTERM, or escalates to SIGKILL/process-group kill is unknown. The design must not rely on SIGHUP-only behavior.
- “Name” in `omp attach <sessionId|name>` should mean the exact live IRC/fleet peer name, not the persisted session title. Existing resume IDs and peer names are distinct contracts.
- The first implementation target may be macOS/Bun, but daemon readiness must prove a different SID/PGID and no inherited terminal descriptors rather than assuming `Bun.spawn({ detached: true })` supplies them.

## Plan

## Summary
Build a true process boundary: a per-session daemon owns `AgentSession`, `SessionRunner`, persistence, queue, children, session-control, IRC heartbeat, and the ownership lease; terminal processes own only TTY state and a controller/observer attachment. Choose B because A needs the same wire protocol and rich-view migration while remaining inside the cmux PTY/session failure domain. The document itself is the only requested change: `docs/fable/drafts/2026-07-16-detach-survival-design.md`, at most 150 lines, with no source edits.

## Changes
### 1. Transport reality section
- State the decisive answer: **today’s disposable-view protocol is in-process, not IPC-serializable**.
- Ground the domain vocabulary: `RUNNER_SCHEMA_VERSION = 1`; command metadata/commands have Effect Schema decoders, but attach/detach are TypeScript interfaces, snapshots/events lack complete wire decoders, and delivery is an in-memory union (`src/runner/protocol.ts:32,58-63,465-508,797-926,928-1220`).
- `SessionRunner` returns Effect closures and scoped subscriptions (`src/runner/session-runner.ts:210-313`); terminal attach creates a local sliding `PubSub`, subscribes directly to `AgentSession`, and returns more Effect closures (`src/runner/session-runner.ts:4057-4357`).
- `TerminalSessionView` contains Effect methods and an Effect `take`, not values that can cross IPC (`src/runner/terminal-session-view.ts:109-294`). `TerminalSessionController` is only a Promise/callback adapter with local listener sets (`src/modes/terminal-session-controller.ts:320-481,1207-1227`).
- The nominal factory boundary is functions and callbacks; the builtin rich factory ignores `_controller` and constructs `InteractiveMode` from a live `AgentSession` (`src/modes/disposable-interactive-view.ts:18-70`). Production injects that same live object graph (`src/main.ts:1542-1575`). This is the largest process-split prerequisite.
- Fleet advertises view range 1.0, but it is compatibility metadata only and is never negotiated by runner attach (`src/session/fleet-capability.ts:3-11,86-110,245-257`). Do not describe it as an existing wire protocol.
- Explicit missing wire pieces: framing, hello/version selection, strict request/response/event codecs, safe projection for `AgentSessionEvent` payloads containing `any`, error envelope, authentication, peer-death detach, backpressure, reconnect, and resync.

### 2. A/B comparison and decision
- **A — keep the combined process after SIGHUP:** lower launch churn and preserves current rich TUI initially. Required work is still large: reason-scoped postmortem cleanup, stdin `end`/`close`, stdout EPIPE handling, terminal-only dispose, removal of all future PTY writes, socket server/client, and rich-view migration. Current SIGHUP runs global cleanup and exits (`packages/utils/src/postmortem.ts:63-113`); host cleanup stops the runner (`src/modes/run-disposable-interactive-mode.ts:104-177`; `src/modes/disposable-terminal-host.ts:153-181`). A remains in cmux’s foreground process group/session and cannot promise survival if close sends TERM/KILL or kills the group. Current `/restart` intentionally preserves the same PID/PTY foreground group (`src/cli/restart-session.ts:264-304`). Reject A as the canonical design.
- **B — daemon + client from launch:** adds bootstrap/readiness/logging and process supervision, but creates the required failure boundary. The daemon starts in a new session/process group with stdin `/dev/null`, terminal-free stdout/stderr, and owns the lease before READY. The client owns `ProcessTerminal`; SIGHUP/SIGTERM/stdin EOF/Ctrl-D save the draft if possible, detach/close locally, and exit without runner stop. Daemon SIGHUP is ignored or treated as reload; daemon SIGTERM is explicit bounded shutdown.
- Worker consequence: task workers already spawn detached and are pipe/abort-supervised (`src/task/spawn-worker-client.ts:31-52,179-193,280-361`). Parenting them under the daemon keeps them alive across view death. Deliberate daemon stop must still reap them; daemon-crash orphan/PDEATH handling is a follow-up, not a reason to parent them under the view.
- Session authority stays singular. Reuse the deterministic ownership namespace keyed by canonical session file + session ID (`src/session/session-ownership.ts:303-317`). Replace the current owner-probe-only server (`src/session/session-ownership.ts:560-650,740-909`) with one framed endpoint that supports both owner proof and runner view traffic; do not add a competing discovery socket or lock.
- Wire design: length-prefixed, bounded JSON frames; hello selects the advertised view-protocol range and validates session ID, owner epoch, runner instance, build, UID/filesystem authority, requested capability, and feature set. Add strict codecs for every frame. Large snapshots are chunked/paged from one sequence baseline—never one unbounded `JSON.stringify`—then ordered events resume after that sequence. Per-client outbound queues are bounded; overflow yields `resyncRequired`, never runner backpressure.
- Connection close/timeout automatically detaches that view and releases its controller epoch only. Explicit `stop` is the sole ordinary path to `SessionRunner.stop`, session disposal, descendant teardown, and lease release (`src/runner/session-runner.ts:4410-4491`). Change current silent controller displacement (`src/runner/session-runner.ts:4019-4049`) to reject unless takeover is explicit and fenced.
- `/restart` remains daemon-authoritative: checkpoint/manifest, terminal receipt, lease release, and same-PID exec stay in the daemon (`src/runner/session-runner.ts:2242-2264`; `src/cli/restart-session.ts:207-304`). Clients see socket loss, re-resolve the lease, validate the new epoch/runner instance, and reattach. A view reload never invokes runner restart.

### 3. Reattach UX/status contract
- Add top-level `omp attach [target]` through `src/cli-commands.ts` and a new `src/commands/attach.ts`.
- Target resolution order: explicit journal path; exact full session ID; exact unique live peer name; unique session-ID prefix. Reject ambiguous names/prefixes with candidates. Existing `--resume` is local ID/file prefix → global exact ID → global prefix (`src/session/session-listing.ts:655-758`); exact peer name is separate (`src/irc/bus-external.ts:473-477`). Attach clients never open a journal as writer or acquire/retire the claim.
- `--cwd` scopes discovery only. `omp attach` without a target uses a proven current-terminal breadcrumb, then a sole proven headless runner in cwd, otherwise the existing picker. Bare `omp`, before creating a new interactive session, auto-attaches only when exactly one proven headless runner exists in the cwd; multiple matches open the picker; zero matches preserve normal new/auto-resume behavior. Existing `--continue` breadcrumb/cwd behavior is at `src/session/session-manager.ts:2380-2452`.
- Model status as orthogonal fields, not one overloaded state: authority `live|suspect|stale|none`; execution `working|waiting_input|idle|unknown`; attachment `controller|observers|headless`; transport `reachable|unreachable`; heartbeat `fresh|stale`.
- `headless` requires a current owner proof + successful runner hello for the same epoch/runner instance + runner running + zero controller views. Stale IRC is disconnected, not dead. Matching live PID with failed proof is suspect/unavailable. Current peer rows lack attachment state (`src/irc/bus-external.ts:12-30`) and expire after 10 minutes (`:133-155`); daemon must heartbeat independently even while state is unchanged (current publication short-circuits at `src/session/agent-session.ts:13014-13058`).
- Hub shows `HEADLESS` alongside WORK/WAIT/IDLE and does not drop a proven headless runner. Fleet adds `ATTACHMENT`/`TRANSPORT`; `--all` may show stale/disconnected history but control targeting requires fresh matching proof. Current Hub drops stale peers (`src/modes/components/agent-hub.ts:1758-1793`) and fleet prints freshness/state only (`src/cli/fleet-cli.ts:173-208`).

### 4. Recommended single implementation wave
Use one clean-cutover vertical wave; no in-process fallback:
1. Add a strict wire protocol and bounded codec; turn the ownership probe server into the runner socket server; add a socket-backed terminal transport/client.
2. Refactor `createTerminalSessionController` to depend on a transport interface implemented by local runner tests and the socket client.
3. Cut the full rich TUI from `AgentSession`/`SessionManager` to a purpose-built `InteractiveSessionClient` backed by `TerminalSessionController`; add missing query/mutation projections rather than a remote `AgentSession` compatibility proxy. Dominant roots: `src/modes/interactive-mode.ts:532-655`, `src/modes/types.ts`, and controller direct accesses in `btw-controller.ts`, `command-controller.ts`, `event-controller.ts`, `extension-ui-controller.ts`, `input-controller.ts`, `input-interrupt-controller.ts`, `mcp-command-controller.ts`, `omfg-controller.ts`, `selector-controller.ts`, `session-focus-controller.ts`, `settings-selector-construction.ts`, `ssh-command-controller.ts`, `tan-command-controller.ts`, `todo-command-controller.ts`, and `tool-execution-construction.ts`.
4. Split `src/main.ts:1187-1590` into daemon construction and client launch. Daemon READY includes PID/SID/PGID, session ID/file, owner epoch, runner instance, socket, build, and selected view protocol. Client never receives ownership or persistence objects.
5. Add attach/bare-cwd discovery, controller reconnect, headless heartbeat/status projection, and daemon-aware restart.
6. Only after the smoke path works, add focused transport/CLI/lifecycle tests and update operator help/changelog.
- Wave acceptance: default interactive launch has distinct daemon/view PIDs and SID/PGID; HUP, TERM, PTY death, and Ctrl-D of the view leave the same daemon PID/owner epoch/runner instance/socket alive; a queued durable follow-up completes headless; a real daemon-owned spawn worker remains alive; heartbeat advances; fresh attach reconstructs the same transcript/queue and accepts new input; stale old controller commands fail; `/restart` replaces/reacquires the daemon and the client reconnects; explicit stop flushes/releases/reaps exactly once.

### 5. Follow-ups
- N−1 wire compatibility/canary matrix and remote observer/multi-controller takeover UX.
- Collab/web clients on the canonical wire and view-bundle hot reload across versions.
- Daemon crash recovery plus explicit worker parent-death/orphan reaping.
- Real cmux close tracing to record PTY close + signal/escalation behavior; Linux/Windows launcher equivalents.
- Transcript cold paging/resource budgets beyond the bounded first wire projection.

## Sequence
1. Write the ≤150-line design doc with reality/decision first; do not imply the current seam is IPC-ready.
2. In the future implementation wave, land codecs and transport contract before server/client code.
3. Migrate rich TUI authority before process launch split; B cannot work while `InteractiveMode` owns live `AgentSession`.
4. Add daemon bootstrap/ownership/heartbeat and client attach only after the rich view compiles against the client interface.
5. Add CLI discovery/status and restart reconnect after stable daemon metadata exists.
6. Run the HR-034 proof last across the complete boundary, then documentation/changelog cleanup.

## Edge Cases
- View dies during attach, snapshot chunking, a command write, or before explicit detach: socket close must release only its view; durable command IDs make retry idempotent.
- Snapshot/event race and queue overflow: establish subscription before baseline, fence by sequence, and force resync on gaps.
- Two launchers race for the same session: atomic claim/owner proof decides one daemon; loser attaches the proven owner, never retires a live/suspect claim (`src/session/session-ownership.ts:1064-1235`).
- Restart socket/epoch turnover: clients rediscover; no stale socket path or controller epoch reuse.
- Unsent editor text on abrupt PTY loss may be unavailable; save drafts on Ctrl-D/orderly detach, but never claim recovery of keystrokes not sent to the runner.
- Broken stdout after PTY loss must disable rendering without repeated allocation/log loops (`packages/tui/src/terminal.ts:1234-1340`).
- Daemon launch must prove terminal independence; if Bun detached spawn does not create a new SID on macOS, use a native `setsid`/daemon helper rather than weakening acceptance.
- Controller attach must not silently steal authority from a live view.
- Heartbeat freshness, process liveness, socket reachability, execution state, and transcript tail status must never be conflated.

## Verification
- HR-034 test home: new `test/runner/session-runner-detach-process.test.ts`, reusing construction/durable-file assertions from `test/runner/session-runner-process.test.ts:21-134,284-299,425-507`.
- Isolate a fresh temp root: HOME, all XDG dirs, OMP_SESSION_DIR, OMP_AGENT_DIR, AGENT_MUX_DIR, explicit `IrcExternalBus(tmp/irc.sqlite)`, and OMP_SESSION_CONTROL_DB. No tmux and no mocks.
- Spawn daemon R with terminal-free stdio; wait READY. Spawn client V1 under real native `PtySession` (`packages/natives/native/index.d.ts:84-98,1264-1290`). Attach controller, record runner/session/epoch/sequence, start a real delayed local operation, a durable custom follow-up with `deliverAs: followUp` and `triggerTurn: false`, and a real synthetic spawn-worker child (`src/task/spawn-worker-client.ts:419-433`; `src/task/spawn-worker-entry.ts:114-141`).
- Kill/close only V1’s PTY. Assert V1 exits; R, its lease proof, and worker remain; IRC `lastSeen` advances; the local operation reaches exit 0; the durable follow-up reaches completed and appends its transcript entry while no view is attached.
- Spawn V2, attach to the same session, and assert same pre-restart daemon PID/owner epoch/runner instance, higher revisions, continuous transcript IDs/content, completed queue item exactly once, and stale V1 commands rejected. Reopen with `SessionManager.open` and compare durable transcript IDs.
- Request daemon `/restart`; assert predecessor handoff, new owner epoch/runner instance, client rediscovery/reattach, and transcript/queue continuity. Then explicit stop, clean daemon exit, socket/claim release, and descendant reap.
- Focused future commands: `bun --cwd=packages/coding-agent test test/runner/session-runner-detach-process.test.ts`; relevant focused restart test; `bun --cwd=packages/coding-agent run check:types`. The design task itself runs no gates because it is read-only.

## Critical Files
- `src/runner/protocol.ts:32,465-508,797-926`
- `src/runner/session-runner.ts:210-313,3970-4095,4300-4491`
- `src/runner/terminal-session-view.ts:109-294`
- `src/modes/terminal-session-controller.ts:320-481,1180-1240`
- `src/modes/disposable-interactive-view.ts:18-70`
- `src/modes/disposable-terminal-host.ts:73-216`
- `src/modes/run-disposable-interactive-mode.ts:50-190`
- `src/modes/interactive-mode.ts:532-955,3060-3170`
- `src/main.ts:620-770,1110-1260,1380-1590`
- `src/session/session-ownership.ts:14-35,303-317,560-650,740-909,1064-1235`
- `src/session/session-listing.ts:655-758`; `src/session/session-manager.ts:2380-2452`
- `src/irc/bus-external.ts:12-30,133-155,335-477`
- `src/cli/restart-session.ts:50-114,207-304`
- `test/runner/session-runner-process.test.ts:21-134,284-299,425-507`
- `docs/fable/harness-runtime-contract.md:201-235,571-576`
