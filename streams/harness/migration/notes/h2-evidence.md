# H2 evidence: park/revive + IRC delivery races

Scope: direct evidence in `vendor/oh-my-pi/packages/coding-agent` for parked-agent revival, IRC delivery/reservation, replacement identity, and the receipt/state vocabulary. Every row below is tied to a source line; entries labelled “adjacent” are included because their changelog text names the same delivery/admission failure family without naming the IRC bus itself.

## 1. Changelog evidence — Unreleased

| Changelog citation | Quoted entry | Failure implied by the entry |
|---|---|---|
| `CHANGELOG.md:12` | “Agent Hub Enter now opens every local, archived, and cross-session row as a transcript preview; attachable agents expose `i` to focus their composer and Esc returns through preview to roster, while running/external/non-revivable rows remain inert with friendly read-only titles.” | The old interaction path treated some running/external/non-revivable rows as unusable; the fix makes preview available without requiring revival. |
| `CHANGELOG.md:18` | “The subagent HUD shows a live per-row tok/s badge …; view reloads reseed the full roster (running, quiet, and parked children) from the registry and journals without waiting for fresh progress events.” | A reload could omit quiet/parked children when no fresh progress event arrived; the registry/journal are now the source for reseeding. |
| `CHANGELOG.md:51` | “Added default-on fleet incident detection for correlated transient network failures, with one IRC/ErrorInbox notice, shared session-control state, connectivity-probed clearing, and journaled automatic child salvage.” | No specific prior failure is stated; the entry records that correlated network incidents require an IRC notice and durable child salvage rather than silent loss. |
| `CHANGELOG.md:57` | “Added `task.maxLiveChildren` FIFO admission control to bound peak live in-process subagents without charging queued time against child runtime limits.” | Unbounded live-child admission was a capacity failure; revival admission must not bypass the live-child bound. |
| `CHANGELOG.md:66` | “IRC communication and tool-result bodies now honor `:wrap`/`:rich` while receipts, errors, metadata, and roster rows remain bounded single-line projections.” | Receipt/error projections previously had no stated bounded single-line guarantee; delivery bodies and delivery metadata are now separated. |
| `CHANGELOG.md:67` | “Task spawning now refuses revivable `NameResume`/exact-id duplicates, warns on running or archived matches with in-band IRC/history guidance, preserves live registry ids during allocation, and reports resume-in-place or transcript-salvage instructions after task failures and restarts.” | Duplicate revival/resume requests and identity allocation could target the wrong live/archive record; the entry explicitly calls for stable live ids and salvage guidance. |
| `CHANGELOG.md:70` | “`Enter` on an empty prompt during streaming now aborts and delivers the next queued durable follow-up exactly once …” | Adjacent delivery race: a queued follow-up could otherwise be lost or delivered more than once around abort/turn completion. |
| `CHANGELOG.md:75` | “Revived parked subagents keep their original tool inventory (an undefined full-capability selection no longer freezes into an empty allowlist), follow-up yield results and errors reach the parent as job/IRC reports, and `history://` renders parked transcripts whose message graph passes through lifecycle entries.” | Revival could freeze an empty tool allowlist, and follow-up yield/error delivery could be swallowed so the parent observed silent parking. |
| `CHANGELOG.md:76` | “Subprocess-isolated task workers now initialize the global Settings proxy before creating tools, terminate cleanly after a terminal result, recover durable yield payloads from child journals when the pipe record is lost, and disable external IRC fallback with a typed coordinator-IPC refusal for unavailable local peers.” | Child pipe loss could strand durable yield delivery; unavailable local peers could incorrectly fall through to external IRC instead of producing a typed refusal. |
| `CHANGELOG.md:87` | “Fixed a Ctrl-Q/abort race that could permanently wedge durable follow-up delivery …” | Adjacent delivery race: overlapping abort/admission maintenance could permanently wedge or duplicate durable follow-ups. |
| `CHANGELOG.md:89` | “Durable-input interrupt/injection tests now isolate their IRC bus and session-control databases under temp dirs instead of registering test peers on the real fleet store.” | Tests previously mutated the real fleet IRC/session-control stores, contaminating peer state and making delivery evidence non-isolated. |
| `CHANGELOG.md:97` | “IRC sends now reserve parked-agent messages before revival and follow replacement identities across revive races, preventing dropped messages and `released or replaced while reviving` failures.” | Direct H2 incident record: check-then-revive delivery could drop a message or fail when the ref/session was released or replaced during revival. |
| `CHANGELOG.md:98` | “Ask-tool waits now publish `waiting_input` IRC presence while they are blocking for user input, then restore the prior state on answer or abort.” | Presence could fail to show the blocking state or fail to restore the prior state after completion/abort. |
| `CHANGELOG.md:99` | “Fixed one-shot `omp irc` CLI commands hanging after opening the external IRC SQLite bus by closing CLI-owned bus handles after each command.” | CLI-owned external bus handles were left open, causing one-shot IRC commands to hang. |
| `CHANGELOG.md:100` | “Agent Hub preview is strictly read-only on entry; `Enter` attaches the selected session in the full TUI, while `R` explicitly revives a parked child.” | Preview entry previously conflated inspection/attachment with revival; the fix separates read-only preview, attachment, and explicit revival. |

## 2. Changelog evidence — 16.0.1

| Changelog citation | Quoted entry | Failure implied by the entry |
|---|---|---|
| `CHANGELOG.md:118` | “Added optional `timeoutSec` … timeout results now surface recovered files created/modified and last assistant text instead of a bare timeout error, with IRC reachability noted when applicable.” | A timeout could previously surface only a bare error and omit whether the child remained IRC-reachable. |
| `CHANGELOG.md:123` | “Added an optional `role` field to `task` spawns … becomes the subagent's display name and telemetry identity in the registry, IRC roster, and Agent Hub, so delegated trees are no longer clones of one generic worker.” | Delegated agents previously lacked distinct role-derived identity in registry/IRC projections. |
| `CHANGELOG.md:125` | “Added a work-aware IRC roster … show each peer's current activity … alongside its role-derived display name … Backed by a new display-only `activity` field on the agent registry.” | IRC roster rows previously lacked enough activity/identity context to coordinate live peers. |
| `CHANGELOG.md:126` | “Added proactive IRC coordination … prompts now actively steer discovery (`list`), coordination … and follow-up (`replyTo`/`await`) instead of only assuming agents resolve collisions on their own.” | Coordination collisions were previously left to agent assumption; the entry adds explicit discovery and reply/wait guidance. |

## 3. IRC bus mechanisms (`src/irc/bus.ts`)

| Site | Mechanism (2–4 lines) | Visible race window / failure boundary |
|---|---|---|
| `src/irc/bus.ts:38-60` | `IrcDeliveryReceipt` has exactly four outcomes: `injected`, `woken`, `revived`, and `failed`; failed receipts carry an error. Delivery records separately track `queued`, `delivered`, `read`, or `failed` and timestamps. | A receipt is a hand-off method, not recipient work completion; the record can remain queued/failed even when a caller only sees the immediate receipt. |
| `src/irc/bus.ts:129-173` | `send` records the message, reads the target ref, and rejects missing/aborted refs. For parked refs it enqueues first, then awaits `ensureLive`; failed revival stays buffered, while a changed parked ref is retried. | The initial ref/status read (`135-142`) precedes revival and later registry reads. The reservation-before-revival ordering is the explicit protection against release/replacement loss. |
| `src/irc/bus.ts:175-212` | After revival, `send` first consumes the oldest matching waiter; otherwise it reads the current session and calls `deliverIrcMessage`. Parked reservations are removed only after successful hand-off; a failed live hand-off is re-enqueued and marked failed. | Waiter/session lookup and session delivery are separate operations after `ensureLive`; a target can be replaced between those reads, with the lifecycle identity guard defining the failure boundary. |
| `src/irc/bus.ts:215-284,391-418` | `wait` drains pending mail by default, otherwise installs a filtered waiter with abort/timeout cleanup. Sends resolve the oldest waiter whose optional `from` filter matches; mailbox waits consume one message. | There is an explicit drain-vs-future-wait choice: `drainPending:false` parks a future waiter even when old mail exists, so callers must choose semantics deliberately. |
| `src/irc/bus.ts:286-389` | `inbox` drains or peeks mailbox contents; delivery summaries count queued/failed records. Queue/history caps are enforced, with the oldest mailbox message dropped over `MAILBOX_CAP` and the oldest history record over `DELIVERY_HISTORY_CAP`. | A slow revival can lose its original mailbox position to cap eviction; the send catch path removes the old reservation and enqueues one tail copy (`202-206`). |
| `src/irc/bus.ts:420-445` | Successful agent-to-agent delivery is relayed as a display-only custom message to Main unless Main is an endpoint. Relay failures are caught and logged without changing delivery. | UI forwarding is intentionally after delivery bookkeeping and cannot turn a successful hand-off into a failed receipt. |

## 4. Agent lifecycle manager and identity logic

| Site | Mechanism (2–4 lines) | Visible race window / failure boundary |
|---|---|---|
| `src/registry/agent-lifecycle.ts:1-10,99-150` | The manager owns idle → parked → revived lifecycle bookkeeping. Adopted agents retain TTL, reviver, revive-slot admission, subscription, and timer; concurrent release/park/revive operations are coalesced in maps. | Only this manager flips parked ↔ idle, but registry status and session attachment are separate mutable fields; callers must use manager operations rather than infer liveness from one field. |
| `src/registry/agent-lifecycle.ts:207-237` | `ensureLive` waits for in-flight parking, reads the ref, returns an existing session, or coalesces an in-flight revive. A parked ref without a reviver throws a typed plain `Error` carrying `history://` guidance. | The first ref read occurs after parking but before revival; a later release/replacement is detected inside `#revive`, not atomically by `ensureLive`. |
| `src/registry/agent-lifecycle.ts:323-381` | `park` publishes registry status `parked` before journal flush or disposal, persists `park`, flushes, then verifies adopted/ref/session identity and status before disposing/detaching. Persistence failure restores `idle` only if the same adopted/ref/session still owns the row. | Publishing `parked` before the first await closes the window where send could target an idle session already being disposed; post-await identity checks prevent an old park from detaching a replacement. |
| `src/registry/agent-lifecycle.ts:460-526` | `#revive` acquires the parent live-child slot while the ref remains parked, recreates the session, then checks adopted identity, registry ref identity, and existing session identity before and after lifecycle persistence. Only then does it attach the session and set `idle`; every failure releases the slot. | The explicit race boundary is the two checks at `483-489` and `509-519`: release/replacement during reviver or flush disposes the new session and throws `released or replaced while reviving`. |
| `src/registry/agent-lifecycle.ts:239-272,401-458` | Release cancels timers/subscriptions/admission, waits for parking and revival, disposes any live session, and unregisters. Stale-orphan reconciliation requires running subagent identity, no live work, durable terminal evidence, flush, re-check, then dispose/detach/park. | Release and revival can overlap; release waits for both, while reconcile re-checks ref/session/status after each await and returns `changed_during_reconcile` instead of guessing. |
| `src/registry/agent-registry.ts:21-27,82-158` | Registry statuses are `running`, `idle`, `parked`, and `aborted`; parked refs retain `sessionFile` while `session` is null. `register` replaces the map entry but preserves `spawnIndex`; `attachSession`, `detachSession`, `setStatus`, and `unregister` mutate the same stable id. | Map replacement can preserve the id while changing the ref object/session; lifecycle code therefore compares ref object identity and session identity, not only the string id. |

## 5. IRC tool receipt paths (`src/tools/irc.ts`)

| Site | Mechanism (2–4 lines) | Visible race window / failure boundary |
|---|---|---|
| `src/tools/irc.ts:193-255` | `list` excludes only `aborted` local peers, projects registry status plus unread/pending/undelivered delivery counts, and explicitly tells users parked agents revive when messaged. | A roster is a projection assembled from registry and bus reads; it can show status/counts from separate snapshots rather than one atomic bus/registry state. |
| `src/tools/irc.ts:263-321` | `send` validates target/message/self/broadcast rules, refuses unavailable subprocess-worker peers with a typed `failed` receipt, and uses external IRC only for a discovered external target. External sends are fire-and-forget and report `injected`. | The subprocess check is a preflight registry/session read before the bus send; direct local sends still go through the in-process bus, while external `await:true` is rejected. |
| `src/tools/irc.ts:321-423` | Awaited sends register a future waiter with `drainPending:false`, send direct/broadcast messages, print every receipt outcome, and wait for the reply only when at least one recipient was delivered to. All-failed sends become `isError`; cleanup aborts the waiter in `finally`. | Broadcast targets are captured from `running | idle` only (`352-356`), so parked peers are intentionally not revived by broadcast; direct sends remain unfiltered and can return `revived`. |
| `src/tools/irc.ts:425-472` | `wait` delegates to `IrcBus.wait`; a timeout returns `waited:null` and a useless informational result, while a message returns formatted content. `inbox` drains/peeks local and external messages separately. | `send await:true` and standalone `wait` have different pending-mail semantics: awaited sends force future-only waiting, while standalone waits drain pending mail by default. |

## 6. Register rows touching H2 paths

| HR id | One-line relevance |
|---|---|
| HR-105 — `docs/fable/harness-request-register.md:45` | Requires one canonical `origin:user|agent|system` delivery-provenance field across internal/external IRC buses. |
| HR-136 — `docs/fable/harness-request-register.md:128` | Records the parked-agent IRC wake failure: revived workers lost tools and yield errors were swallowed, producing silent parent-visible parking. |
| HR-138 — `docs/fable/harness-request-register.md:127` | Requires idle/parked peers to remain addressable for rollout targeting and wake/recovery. |
| HR-140 — `docs/fable/harness-request-register.md:124` | Separates read-only preview from attachment and explicit revival, including non-revivable rows. |
| HR-144 — `docs/fable/harness-request-register.md:107` | Requires reload to rehydrate the full registry/journal roster, including quiet and parked children without fresh progress. |
| HR-145 — `docs/fable/harness-request-register.md:108` | Calls for scoped resource ownership around lifecycle cleanup, leases, and spawn subprocesses—the resource seam surrounding park/revive. |
| HR-163 — `docs/fable/harness-request-register.md:130` | Directly requires durable child completion/edit/IRC behavior when teardown parks children and forbids external-bus loopback. |
| HR-164 — `docs/fable/harness-request-register.md:68` | Names H2 explicitly: park/revive plus bus delivery races as a contract-first Effect migration hotspot. |

## 7. Known outcome and state vocabulary

| Vocabulary family | Values actually defined or projected | Citation |
|---|---|---|
| In-process IRC receipt outcome | `injected`, `woken`, `revived`, `failed` | `src/irc/bus.ts:38-45` |
| Delivery record state | `queued`, `delivered`, `read`, `failed` | `src/irc/bus.ts:44-60` |
| Local registry status | `running`, `idle`, `parked`, `aborted` | `src/registry/agent-registry.ts:21-27` |
| Durable child lifecycle state | `running`, `idle`, `parked`, `completed`, `failed`, `interrupted` | `src/task/child-lifecycle.ts:24-25` |
| Lifecycle timeline kind/edge | kinds `idle`, `park`, `revive`; `fromState` is `idle|parked`; `toState` is `idle|parked` | `src/task/route-events.ts:28-39` |
| External IRC peer state | `unknown`, `working`, `waiting_input`, `idle`; display adds `disconnected` | `src/irc/bus-external.ts:10-14` |
| Tool wait result | A consumed `IrcMessage`, or `null` on timeout; `IrcDetails.waited` carries the same distinction | `src/tools/irc.ts:85-93,425-441` |

## Candidate invariants

- **I1 Reservation-before-revive:** A direct send to a parked ref records and enqueues the message before revival begins; a failed/superseded revive leaves that reservation recoverable. [`src/irc/bus.ts:142-173`; `src/registry/agent-lifecycle.ts:472-481`]
- **I2 Exact hand-off once:** A parked reservation is removed only after a waiter/session hand-off succeeds; failed hand-off records failure and leaves one buffered copy for recovery. [`src/irc/bus.ts:175-212`]
- **I3 Replacement fencing:** Revival must reject and dispose the new session if adopted-agent, registry-ref, or session identity changes before or after lifecycle persistence. [`src/registry/agent-lifecycle.ts:483-519`]
- **I4 Park publication precedes teardown:** The registry becomes `parked` before park flush/disposal, and only the same ref/session may later detach; a replacement cannot be detached by the old park. [`src/registry/agent-lifecycle.ts:333-381`]
- **I5 Receipt honesty:** Every receipt is one of `injected|woken|revived|failed`; failed receipts carry an error, and the tool marks the send as an error only when all captured targets failed. [`src/irc/bus.ts:38-45`; `src/tools/irc.ts:369-418`]
- **I6 Waiter ordering and filtering:** Pending-mail drain, future-only wait, timeout, abort cleanup, and oldest matching waiter resolution are explicit semantics; no send may resolve a nonmatching waiter. [`src/irc/bus.ts:215-284,391-418`]
- **I7 Broadcast non-stampede:** `to:"all"` targets only registry-visible `running|idle` peers; direct sends are the only tool path that revives parked recipients. [`src/tools/irc.ts:352-365`]
- **I8 Stable identity, mutable attachment:** A stable agent id may retain its spawn index across registry replacement, but lifecycle correctness requires ref-object and session-object identity checks before attach/detach. [`src/registry/agent-registry.ts:82-158`; `src/registry/agent-lifecycle.ts:483-519`]
- **I9 Release waits for in-flight lifecycle work:** Release must await parking and revival before disposal/unregister and must release timers, subscriptions, and admission exactly at teardown. [`src/registry/agent-lifecycle.ts:239-272`]
- **I10 UI projection is non-authoritative:** Main-UI relay and roster projections may fail or observe separate snapshots without changing the bus hand-off result; delivery state remains owned by the bus. [`src/irc/bus.ts:323-362,420-445`; `src/tools/irc.ts:193-225`]
