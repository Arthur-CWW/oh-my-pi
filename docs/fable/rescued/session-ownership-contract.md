> Rescued 2026-07-13 from /Users/arthur/agents/local/session-ownership-contract.md

# Durable OMP session ownership and heartbeat contract

Status: implementation-ready contract

Scope: one local-machine ownership mechanism for an `agent-mux` host and the OMP parent session it supervises. It closes two races: closing an attached terminal must not kill the controller, and a replacement OMP process must not re-adopt children while an older external controller still owns their parent session.

## 1. Non-negotiable invariants

1. **One lease is the write/control truth.** For a resumed OMP parent session, exactly one owner epoch may write the parent JSONL or control its direct children. `state.json`, ledger events, registry rows, PIDs, and the existence of a socket are observations, not additional locks.
2. **The daemon, not an attached terminal, owns a hosted session.** Detach, client EOF, terminal close, and the loss of every observer do not release or stop the lease, daemon, PTY child, or heartbeat.
3. **Direct children inherit the parent lease.** A direct child's `session_init.subagent.parentSessionFile` and `parentSessionId` bind it to the parent lease. There is no child lock file and no second child-ownership table. The owning parent controller may park/revive/release those children in-process; another controller may only re-adopt them after the parent lease is conclusively not live.
4. **Uncertainty is not staleness.** A fresh heartbeat without a socket response, a matching live process with an unresponsive socket, a corrupt matching lease, or a changing lease during inspection is `suspect`. A suspect owner blocks resume and re-adoption.
5. **A lease epoch fences PID reuse and old writers.** Ownership identity is not a PID. Every successful acquisition creates a cryptographically random epoch and includes boot and process-start identity. All mutations and socket proofs carry that epoch.
6. **Restart never continues an in-flight turn.** After a dead owner is replaced, eligible children are registered `parked` with `turnState: "interrupted_by_restart"`. Old `AsyncJobManager` jobs, polls, queued swaps, and running status are never reconstructed.
7. **Observers never become owners.** Read-only attach/probe clients can replay and follow output, but cannot send input, resize, kill, release, heartbeat, or alter attached/detached status.
8. **Local filesystem only.** The protocol relies on same-volume atomic `mkdir`/`rename` and durable file replacement. It is supported on local APFS/HFS+. NFS, SMB, synced folders, and cross-volume lease moves are rejected rather than treated as safe.

## 2. Existing seams to preserve

- Reuse `~/.agent-mux/<encoded-name>/state.json` as the operator-facing projection and `sock` as the hosted owner's challenge/attach endpoint.
- Keep the daemon as the sole PTY owner. Current detach behavior in `packages/agent-mux/src/daemon.ts` already leaves the child running.
- Keep OMP child discovery through `MuxState.ompSessionFile`, but persist the parsed OMP session id as well.
- Keep the existing OMP `AgentRegistry` and `AgentLifecycleManager` as the only in-process child lifecycle. External ownership is checked before those structures are populated; it does not replace them.
- Keep IRC as the sole wake/steer path after successful re-adoption.
- Keep state and lifecycle outbox records as projections/history. Neither is allowed to grant ownership.

## 3. Authoritative artifact

The lease for parent session `(canonicalSessionFile, sessionId)` lives under the existing agent-mux root:

```text
~/.agent-mux/
  owners-v1/
    <sha256(utf8(canonicalSessionFile + "\0" + sessionId))>/
      claim/                  # existence is the atomic claim
        lease.json            # authoritative owner identity + heartbeat
        owner.sock            # standalone owner only; mux owners point at existing mux sock
      retired-<epoch>/        # temporary quarantine during release/takeover
  <encoded-mux-name>/
    state.json                # projection, never a lock
    sock                      # existing mux attach/control/proof socket
    daemon.log
```

`canonicalSessionFile` is `realpath(parent directory) + basename`, after rejecting a missing/non-regular resume target. This preserves identity if the file itself is atomically rewritten. The hash is only a path key; readers must compare the full decoded identity in `lease.json`.

`lease.json` is Effect Schema-decoded at every process boundary and has this closed v1 shape:

```ts
interface SessionLeaseV1 {
  readonly version: 1
  readonly sessionFile: string
  readonly sessionId: string
  readonly ownerKind: "agent-mux" | "omp"
  readonly ownerEpoch: string
  readonly muxName: string | null
  readonly socketPath: string
  readonly daemonProcess: ProcessIdentity | null
  readonly controllerProcess: ProcessIdentity
  readonly phase: "acquiring" | "running" | "releasing"
  readonly acquiredAtUnixMs: number
  readonly heartbeatSeq: number
  readonly heartbeatAtUnixMs: number // diagnostics only
}

interface ProcessIdentity {
  readonly bootId: string
  readonly pid: number
  readonly startFingerprint: string
}
```

- `ownerEpoch` is `crypto.randomUUID()`, not a timestamp, PID, or counter.
- `bootId` is a normalized `LC_ALL=C sysctl -n kern.boottime` value.
- `startFingerprint` is the normalized result of `LC_ALL=C ps -o lstart= -p <pid>` captured immediately after spawn/acquire. PID liveness is accepted only when boot id and start fingerprint also match.
- `heartbeatAtUnixMs` is for logs/UI. No stale decision subtracts wall-clock timestamps.
- A mux-hosted lease points `socketPath` at the existing per-mux `sock`; a directly hosted OMP process uses `claim/owner.sock`. This is still one lease truth. The socket only proves the holder of the epoch is responsive.

`MuxState` gains the projection fields `ompSessionId`, `ownerEpoch`, `heartbeatSeq`, and `heartbeatAtUnixMs`. A disagreement between `state.json` and `lease.json` is reported; `state.json` never wins.

## 4. Atomic acquire and fencing

### 4.1 New session

A new OMP session chooses its session file and id before opening its JSONL writer, then acquires the corresponding lease. A mux daemon acquires on behalf of the controller before spawning it; a non-mux OMP process acquires with `ownerKind: "omp"` before `FileSessionStorage.openWriter`.

### 4.2 Resume/revive

The resume target and its persisted session id are known before `createSession`. The prospective owner must:

1. Canonicalize the target and compute the lease directory.
2. Atomically `mkdir(claim)`. Success reserves the identity; no JSONL writer or PTY child exists yet.
3. Write `lease.json` with phase `acquiring`, fsync the file, atomically rename the temporary file in the same directory, and fsync `claim` and its parent.
4. Bind the proof socket. A mux owner binds the existing mux socket **without first unlinking it**. A standalone OMP owner binds `claim/owner.sock`.
5. Re-read `lease.json`; the epoch must still match.
6. Spawn/open the controller, capture its `ProcessIdentity`, then atomically replace the lease with phase `running`.

Failure at any step before `running` removes only the caller's matching epoch. It never unlinks another epoch's socket or claim.

### 4.3 Existing claim

A contender classifies the existing lease using section 6. `live` or `suspect` returns a typed refusal. `stale` permits takeover:

1. Re-read and require the same old epoch and heartbeat sequence used for classification.
2. Atomically rename `claim` to `retired-<oldEpoch>`. `ENOENT`, `EEXIST`, or an epoch/sequence change restarts classification; it never means success.
3. `mkdir(claim)`. Concurrent contenders race on this single operation; exactly one can win.
4. The winner writes its new `acquiring` epoch and follows normal acquisition. Losers classify again and observe the winner.
5. Remove the retired directory only after the new running lease is durable.

An owner heartbeat never creates a missing `claim` directory. If its epoch disappears or changes, the owner is fenced: stop accepting control/input, close its proof socket, terminate its owned controller/PTY child with the existing TERM/5-second/KILL policy, and never write either JSONL or lease again.

Automatic takeover is forbidden while either recorded controller or daemon process still has the same full `ProcessIdentity`. A hung but alive process is `suspect`, not stealable. Operator-forced termination is a separate explicit action and must re-check the full process identity immediately before signaling; a reused PID is never signaled.

## 5. Heartbeat and release

- Interval: 2 seconds. Suspect threshold: 10 seconds (five missed intervals). Probe timeout: 500 ms.
- Only the current epoch increments `heartbeatSeq`. Each heartbeat atomically replaces and fsyncs `lease.json`; updates to `state.json` are serialized after it as a projection.
- The owner also heartbeats immediately after entering `running`, after a successful control attach, and after recording the OMP session identity.
- Wall-clock movement, sleep/wake, and NTP changes cannot make an owner stale. A replacement measures whether `heartbeatSeq` changes using its own monotonic clock.
- macOS sleep may delay both processes. On wake, a matching process identity or successful proof remains `live`; a paused owner is never stolen merely because its last wall timestamp is old.

Graceful release order is:

1. Atomically set phase `releasing`; reject new input/claims but continue read-only status/proof.
2. Stop/dispose the controller and wait until its full process identity is gone.
3. Persist terminal mux state and lifecycle events; close the proof/attach socket.
4. Re-read the epoch, rename `claim` to `retired-<epoch>`, fsync the parent, then remove the retired directory.

Terminal detach and observer disconnect do not enter this path. Explicit mux `kill`, clean OMP exit, daemon shutdown after child exit, and an explicit standalone OMP shutdown do.

A crash leaves `claim` in place. Recovery classifies it; it does not infer release from a missing socket alone.

## 6. Probe and stale classification

The existing mux JSONL protocol adds packets that do not require attach:

```ts
{ t: "ownerProbe", nonce: string, expectedEpoch: string,
  sessionFile: string, sessionId: string }

{ t: "ownerProof", nonce: string, ownerEpoch: string,
  sessionMatch: boolean, phase: "acquiring" | "running" | "releasing",
  heartbeatSeq: number }
```

The server returns proof only if its in-memory epoch, current `lease.json` epoch, and requested session identity all match. The nonce must be echoed exactly. A stale socket from an old process therefore cannot prove a new lease.

Classification result is one of:

| Result | Required evidence | Resume/re-adopt action |
|---|---|---|
| `none` | No claim exists and no matching mux `state.json` projection exists | May acquire |
| `live` | Matching nonce/epoch proof, or a matching full controller/daemon process identity plus a heartbeat sequence that advances during the 10-second observation | Refuse; offer existing mux attach path when present |
| `stale` | No proof; boot differs or every recorded full process identity is absent/mismatched; epoch and heartbeat sequence remain unchanged through the final re-read | May quarantine and acquire |
| `suspect` | Anything else: fresh/advancing heartbeat without proof, same full process identity but no proof, live child with dead daemon, clock/process inspection failure, malformed matching lease, or lease mutation during bounded retries | Refuse and emit diagnostic; never adopt |

A boot-id mismatch makes recorded PIDs irrelevant and permits stale classification after the final stable-epoch read. A PID with a different start fingerprint is reuse, not the owner; it is neither proof nor a signal target.

Lookup retries at most three times when epoch/sequence changes. Continued churn is `suspect`. A malformed lease is matched conservatively using the same directory key and any matching `state.json` projection, then reported `owner_record_corrupt`; it is never deleted automatically.

## 7. Same-parent child ownership

No per-child lease is added. A child is covered by a parent lease only when all of these are true:

- child metadata is structurally valid;
- canonical `parentSessionFile` equals the lease's `sessionFile`;
- `parentSessionId` equals the lease's `sessionId`;
- the child is a direct durable child of that parent.

While the parent lease is live or suspect, another process must not register, revive, steer, release, or mark that child running. It may read the immutable transcript as an observer. Isolated children remain history-only even after the lease is stale.

A parked child remains owned by its live parent controller. Parking disposes a child `AgentSession`; it does not release the parent lease. Explicit child release removes only the in-process registry/lifecycle handle and leaves the parent lease intact.

## 8. Attach and read-only observers

Change attach to require `mode: "control" | "observe"` (clean cutover; update all callers).

- At most one control client. It may input, resize, detach itself, and request kill under existing rules.
- Any number of observers. They receive replay, output, status, proof, and exit. `input`, `resize`, `kill`, or ownership packets that mutate state receive `deny` and have no side effect.
- Observer attach/detach does not set `running-attached`, update terminal dimensions, change `lastAttachAt`, or emit the control attach/detach lifecycle pair. If observer audit is desired, use distinct `muxObserve`/`muxUnobserve` events.
- Loss of the control client changes mux status to `running-detached` but leaves observers connected and the owner heartbeat running.

## 9. OMP startup and re-adoption behavior

Ownership lookup must happen after the resume file/id are resolved but **before** `createSession`, `FileSessionStorage.openWriter`, global registry mutation, extension startup, or child re-adoption.

For a direct `omp --resume`/`--continue`:

- `live`: exit with typed `ExternalSessionOwner` and include mux name/attach command when available. Do not open the session writer.
- `suspect`: exit with typed `ExternalSessionOwnerUnverifiable`; do not offer destructive recovery.
- `none` or confirmed `stale`: acquire the lease, then create the session. The OMP process owns and heartbeats it unless the mux daemon supplied a matching acquired epoch through `OMP_SESSION_OWNER_EPOCH` and `OMP_SESSION_OWNER_SOCKET`.
- If a supplied epoch does not match the on-disk lease, fail before session creation. The child never silently falls back to a second OMP-owned lease.

`reAdoptDirectChildren` receives the already-acquired parent ownership handle and verifies it again before scanning and immediately before each registry registration. This closes the check/use gap. It may adopt only when the caller owns the current epoch.

Extend diagnostics with:

- `external_owner_live`
- `external_owner_unverifiable`
- `owner_record_corrupt`
- `ownership_lost`

On any of these, the affected child remains history-only. `ownership_lost` aborts the whole re-adoption pass and releases any parked rows registered during that pass; a half-adopted roster is forbidden. Existing `corrupt_journal`, `stale_parent`, `isolated`, `id_collision`, `unavailable_model`, and `reviver_unavailable` behavior remains per-child and must not block valid siblings.

The acquired replacement registers eligible children under the same stable ids as `parked`, creates revivers using current auth/model policy, and records `turnState: "interrupted_by_restart"`. It never reports a former running turn as live or resumed.

## 10. Exact, disjoint implementation slices

The slices deliberately have no overlapping files. Slice A publishes the wire/on-disk contract first; Slice B consumes it. If both run concurrently, Slice B codes to this pinned v1 schema and does not edit agent-mux files.

### Slice A — owner host, lease, heartbeat, attach survival

Exclusive files:

- `packages/agent-mux/src/ownership.ts` (new): schemas, canonical key, process identity provider, atomic acquire/takeover/release, heartbeat, probe classification.
- `packages/agent-mux/src/protocol.ts`: pinned owner probe/proof packets, required attach mode, `MuxState` projection fields.
- `packages/agent-mux/src/state.ts`: durable atomic/fsynced projection writes; no ownership decisions.
- `packages/agent-mux/src/daemon.ts`: acquire before unlink/bind/spawn, existing-socket proof, heartbeat loop, epoch fencing, observer set, release ordering.
- `packages/agent-mux/src/cli.ts`: pass known resume identity to daemon, classify refusal, control-mode attach, attach hint.
- `packages/agent-mux/src/client.ts`: required control/observe mode and observer input prohibition.
- `packages/agent-mux/src/index.ts`: public ownership schemas/result types needed by package-local callers.
- `packages/agent-mux/test/ownership.test.ts` (new), `test/daemon.test.ts`, `test/client.test.ts`.

Invariant delivered: a mux daemon owns one epoch for the hosted OMP parent; a terminal client owns nothing, and no second mux/OMP owner can take the same live lease.

### Slice B — OMP acquire guard and re-adoption integration

Exclusive files:

- `vendor/oh-my-pi/packages/coding-agent/src/session/session-ownership.ts` (new): self-contained v1 lease decoder/client, direct-OMP acquire/heartbeat/release, mux epoch validation, and typed lookup results. It does not import the workspace package or create another lock path.
- `vendor/oh-my-pi/packages/coding-agent/src/main.ts`: resolve/check/acquire before session creation; pass the acquired handle into re-adoption; release on the existing main-session shutdown path.
- `vendor/oh-my-pi/packages/coding-agent/src/task/re-adopt.ts`: require current ownership handle, pre-scan and pre-register epoch checks, new diagnostics, rollback on ownership loss.
- `vendor/oh-my-pi/packages/coding-agent/src/session/session-manager.ts`: choose/expose new session file/id before opening the writer and bind writer lifetime to the acquired handle; no second lock.
- `vendor/oh-my-pi/packages/coding-agent/test/session/session-ownership.test.ts` (new), `test/task/re-adopt.test.ts`, and the narrow startup test file that already covers resume initialization.

The OMP module duplicates only the closed boundary decoder because the package must remain self-contained. It uses the exact same `owners-v1` artifact and epoch; it must not introduce `~/.omp/*.lock`, a registry ownership bit, or a second heartbeat.

Invariant delivered: a replacement cannot open the parent writer or reconstruct child control handles unless it owns the current parent epoch.

### Integration ownership

After A and B land, one integration pod owns only:

- `packages/agent-mux/test/omp-ownership.integration.test.ts` (new fixture test; real local OMP startup may be replaced by the smallest compiled OMP fixture process, but not a mocked socket or filesystem).

It may report defects to A/B owners but does not edit their source files. This keeps behavioral proof independent and avoids a third implementation surface.

## 11. Required failure and behavior tests

### Slice A tests

1. Two concurrent acquires for the same session identity: exactly one `mkdir(claim)` succeeds; loser returns `live`/`suspect`, never overwrites epoch.
2. A second `agent-mux new` cannot unlink the first daemon's socket, replace its state, or spawn a second child.
3. Control client disconnect: daemon and child process identities remain live, heartbeat sequence advances, detached output accumulates, and reattach replays it.
4. Close all control and observer sockets: same survival assertions; lease is unchanged.
5. Two observers plus one controller: all receive output; observer input/resize/kill are denied and terminal state is unchanged.
6. Dead daemon and dead child with stable epoch: stale takeover quarantines old claim and exactly one contender gets a new epoch.
7. Dead daemon but matching live child: `suspect`; no takeover and no signal.
8. Matching live PID/start fingerprint with no socket response: `suspect` after threshold, not stale.
9. PID reuse: same PID/different start fingerprint is not proof and is never signaled.
10. Boot change: old PIDs are ignored; stable old lease can be taken after final epoch check.
11. Wall clock jumps backward/forward and sleep-sized gaps: classification depends on monotonic observation/sequence, never timestamp subtraction.
12. Lease renamed while owner heartbeat is pending: heartbeat fails closed and owner executes fencing; it never recreates `claim`.
13. Epoch changes during probe/classification: retry; three changes yield `suspect`.
14. Truncated/malformed `lease.json` with matching key/state: `owner_record_corrupt`; no deletion or takeover.
15. Injected write/fsync/rename/bind/spawn failure at every acquisition stage: no running child without a running lease, and cleanup removes only the caller's epoch.
16. Graceful kill: phase becomes releasing, child is gone before claim removal, terminal state/outbox is persisted, socket and claim disappear.
17. Protocol proof with wrong nonce, epoch, path, or session id is denied and cannot establish liveness.
18. Atomic-read stress on a local test directory: readers observe complete old or new lease documents, never partial JSON. Filesystem capability rejection is covered without using a network share.

### Slice B tests

1. Live mux-owned parent: startup returns `ExternalSessionOwner` before `openWriter`; `reAdoptDirectChildren` registers nothing and reports `external_owner_live`.
2. Suspect/unresponsive owner: startup returns `ExternalSessionOwnerUnverifiable`; no writer, registry row, reviver, or lease takeover.
3. Corrupt matching lease: typed `owner_record_corrupt`; no destructive cleanup.
4. Confirmed stale owner: replacement acquires a new epoch, eligible child is parked, and its recovery state is exactly `interrupted_by_restart`.
5. No external owner: direct OMP acquires before writer open and existing successful re-adoption behavior remains.
6. Mux-supplied epoch matches: OMP uses it and does not create a second claim. Missing/mismatched epoch fails before writer open.
7. Ownership changes after scan but before registration: `ownership_lost`, all rows added by that pass are rolled back, no reviver remains adopted.
8. Ownership changes after writer creation: writer refuses subsequent append through the bound handle and shutdown begins; old epoch never writes again.
9. Symlinked parent path canonicalizes to the same lease and is blocked by the live owner.
10. Same path but different persisted session id is a corrupt/identity-mismatch refusal, never treated as the same resumable session.
11. Valid sibling plus isolated, corrupt, stale-parent, collision, and unavailable-model children: only the valid child is adopted after ownership is acquired; one bad child does not block it.
12. Parked child under a live parent is still externally owned and cannot be re-adopted.
13. Successful revival uses current auth/model policy and the existing lifecycle/IRC path; no old async job or `running` state is created.
14. Graceful main-session disposal releases only its matching epoch. A replaced/mismatched epoch is left untouched.

### Cross-slice integration proof

1. Start a hosted OMP fixture under agent-mux, create a parent and direct-child JSONL, attach, then kill only the attach client. Verify advancing owner proof and child output while detached.
2. Start a replacement against the same parent. Verify it exits before opening the writer and reports the existing mux attach target; child re-adoption count is zero.
3. Reattach and prove output produced during detachment is replayed.
4. Kill the hosted owner and wait for full process-identity disappearance/release (or inject an abrupt crash and obtain confirmed stale classification).
5. Start the replacement again. Verify it acquires a different epoch, registers the child parked under the same id with `interrupted_by_restart`, and revives it only when the existing lifecycle/IRC path is invoked.
6. Assert at every checkpoint that there is one claim directory, one current epoch, and no concurrent parent JSONL writers.

## 12. Explicit non-goals

- No distributed lease, database lock, or ledger-mediated ownership.
- No child-per-process conversion.
- No resurrection of in-flight turns or async job ownership.
- No compatibility lock under `~/.omp`; clean cutover uses `owners-v1` only.
- No inference of ownership from JSONL tail status, PID alone, `state.json` alone, socket-file existence alone, or terminal attachment.
- No automatic stealing from a hung but identity-matching process.
