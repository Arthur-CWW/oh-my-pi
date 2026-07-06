# agent-mux — session survival supervisor (tmux-like detach/attach for agent TUIs)

Status: active (v1 implementation contract)
Date: 2026-07-04
Parent spec: `docs/plans/pi-agent-control-plane.md` (L1 adapter + session-status groundwork for the L3 meta-agent/dashboard)
Research: `docs/research/pi-agent-control-plane/omp-publisher-seams.md` (scout S3 irc follow-ups), PTY backend report (librarian S4, agent://PtyBackendResearch)

## Problem

Closing cmux (or any terminal client) SIGHUPs the omp process: postmortem runs cleanup and exits (129) — running turns die with the tab. Separately, `--continue` resume is keyed to a terminal-ID breadcrumb (`session-paths.ts` writeTerminalBreadcrumb/getTerminalId), so a force-closed terminal app mints new terminal IDs and resume "randomly" fails — 198/198 real session JSONLs scanned structurally clean; file corruption is ruled out. OMP has no pid/lock/heartbeat; status is derived from the JSONL tail only.

## Decisions (settled 2026-07-04)

- **Backend: native Bun PTY** — `Bun.spawn(cmd, { terminal: { cols, rows, data } })` (shipped Bun v1.3.5; we run 1.3.14). NEVER the pre-created `new Bun.Terminal` form (controlling-terminal bug, Bun #33237/#33240). Rationale: zero deps; tmux fallback forecloses the kitty keyboard protocol pi-tui probes for. Known risk: macOS sleep/wake PTY allocation (Bun #25912) — mitigate by detecting fast zero-exit spawns and surfacing a `spawnFlapped` event; recycle is manual in v1.
- **Topology: per-session daemon, dtach model.** `agent-mux new` double-forks a detached daemon owning ONE PTY + ONE unix socket. No central daemon in v1 (crash isolation; the M2 plane daemon can supervise these later). Client death NEVER affects the daemon/child.
- **Resume: explicit only.** The supervisor never uses `--continue`. It discovers the omp session file created by its child (watch `~/.omp/agent/sessions/<encoded-cwd>/` for the file that appears after spawn) and records it; `agent-mux revive <name>` respawns with `--resume <file>`. This bypasses the terminal-breadcrumb bug entirely.
- **Exit semantics:** input passes through verbatim — Ctrl-D/Ctrl-C inside the hosted TUI behave exactly as in a real terminal (clean omp exit = daemon records exit + cleans up). Detach is client-side only: `Ctrl-\` (0x1C) by default, or socket disconnect. `agent-mux kill` = SIGTERM child (postmortem flushes), SIGKILL after 5s.
- **Ledger integration: mux is a publisher.** The daemon appends event envelopes to its own outbox (`~/.agent-control-plane/outbox/mux-<name>.jsonl`) using the `@wirebabel/control-plane` wire format (v1 envelopes, kind `event`, per-outbox monotonic seq). NEVER writes SQLite (ingestion contract). Event kinds: `muxSessionStart`, `muxAttach`, `muxDetach`, `muxChildExit`, `muxKill`, `muxRevive`, `muxSpawnFlapped` — payloads carry `{muxName, cwd, pid, ompSessionFile?, ompSessionId?, clientId?, exitCode?}`.
- **Status model** (replaces "rethink thread status"): `starting | running-attached | running-detached | exited | failed`. Derived facts live in the daemon state file `~/.agent-mux/<name>/state.json` (pid, socket path, child pid, ompSessionFile, status, lastAttach), heartbeat = pid liveness check (`kill -0`). Ledger events give the dashboard/meta-agent the history; state.json + socket give the live view.

## Layout

```
packages/agent-mux/
  package.json          # @wirebabel/agent-mux, private, self-contained; dep: effect, @wirebabel/control-plane (workspace)
  tsconfig.json
  src/
    protocol.ts         # framed unix-socket protocol (Effect Schema) — PKT-1 writes FIRST, PKT-2 consumes
    daemon.ts           # PTY host: spawn child, scrollback ring, socket server, state file, outbox events
    client.ts           # attach client: raw-mode stdin relay, detach key, resize, --pipe mode for scripts
    state.ts            # state.json read/write (Schema), session dir layout, pid liveness
    outbox-events.ts    # mux event envelope helpers over @wirebabel/control-plane outbox
    cli.ts              # new | attach | ls | kill | revive  (same hand-rolled parser style as control-plane)
    index.ts
  test/                 # bun test; fixtures under test/.tmp; hosted test child = bash/cat, never a real agent
```

## Protocol (inter-packet contract — pinned)

Unix socket at `~/.agent-mux/<name>/sock`, mode 0600. JSON lines (one message per `\n`), payload bytes base64. Effect Schema `MuxMessage` union:

- client→daemon: `{t:"attach", clientId, cols, rows, replay?: boolean(default true)}`, `{t:"input", data}`, `{t:"resize", cols, rows}`, `{t:"detach"}`, `{t:"kill"}`, `{t:"status"}`
- daemon→client: `{t:"replay", data}` (scrollback, sent once on attach, before live output), `{t:"output", data}`, `{t:"status", state: {...state.json fields}}`, `{t:"exit", code, signal}`, `{t:"deny", reason}` (second concurrent writer attach → read-only or deny; v1: deny with reason, single client at a time)
- After attach: daemon calls `terminal.resize(cols, rows)`; if dims unchanged, resize to (cols, rows±1) then back to force SIGWINCH repaint.
- Scrollback: in-daemon ring buffer of raw PTY bytes, cap 512 KiB, replayed verbatim on attach.

## Packets

- **PKT-1 mux-core** (`daemon.ts`, `protocol.ts`, `state.ts`, `outbox-events.ts`, scaffold, `test/daemon.test.ts`): the daemon process + protocol schema. `agent-mux-daemon` entry (invoked by cli `new` via detached Bun.spawn of `bun src/daemon.ts --name ... --cwd ... -- cmd...`).
- **PKT-2 mux-client-cli** (`client.ts`, `cli.ts`, `test/client.test.ts`): attach client + CLI. Consumes `protocol.ts` (owned by PKT-1 — written first; irc-coordinate if missing).
- **PKT-3 publisher-attribution** (control-plane package, independent): entry-id attribution backfill — see below.

## PKT-3: publisher entryId attribution (closes the attribution loop)

Scout facts: assistant `message_end` fires BEFORE persistence (`agent-session.ts:2178-2353`); entry id minted in `SessionManager.appendMessage` (`session-manager.ts:1125`) — NOT available at message_end. Retries/fallbacks: message_end fires per attempt; `auto_retry_*`/`retry_fallback_*` events distinguish attempts.

Design: publisher caches `{modelCallId, messageTimestamp}` at message_end; on the NEXT observed event (turn_end or later message_start), reads `ctx.sessionManager.getEntries()` tail, finds the persisted assistant entry matching the cached timestamp, and emits an `attribution` event envelope `{modelCallId, entryId, attribution: "provider/modelId[:thinkingLevel]"}`. Ingest handles `attribution` events with a new idempotent ledger op `attributeModelCall(modelCallId, entryId)` — `UPDATE model_calls SET entryId = ? WHERE id = ? AND entryId IS NULL` (re-ingest safe: second update is a no-op because entryId is no longer NULL; result reports `{updated: boolean}`).

## Acceptance (v1)

Scripted (coordinator-run, `--pipe` client mode, hosted child = tick loop):
1. `new` → daemon alive, state.json `running-detached`, outbox has `muxSessionStart`.
2. attach (pipe) → replay + live ticks; kill the CLIENT process → daemon + ticks continue (`running-detached`).
3. re-attach → replay contains ticks emitted while detached.
4. `kill` → child terminated, `exited` state, `muxChildExit`+`muxKill` events; socket removed.
5. `control-plane ingest` the mux outbox → events queryable via `events --kind muxSessionStart`.

Live (pty): host real `omp` in mux, attach from a PTY, see the TUI, detach, reattach, Ctrl-D quits omp cleanly, daemon cleans up.

## Constraints for workers

Same as control-plane M1 (contract doc `docs/plans/control-plane-m1.md` §Constraints + §DST rules): Effect v4, no any/unknown outside boundaries, Schema at boundaries, no mocks, repo-local test/.tmp, no Date.now/Math.random in src (Clock/injectable), report file first, coordinator gates. PTY/socket modules are typed boundary modules. Workers NEVER run a real agent (`omp`) in tests — bash/cat/sleep children only.
