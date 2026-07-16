# H2 contract: mailbox + park/revive delivery (state machine + invariants)

Status: DRAFT — requires Arthur's read before any H2 port wave
Authored by Fable, 2026-07-16, from live IRC/lifecycle seams and the HR-136/HR-163 incident record.
This document is the executable-model source of truth for H2: the future pure model, DST driver, and trace-conformance checker enforce it; every intentional deviation from current behavior is a `DIVERGENCES.md` row citing a clause here.

## States

The mailbox owner serializes lifecycle commands and message commands for one stable `recipientId`. A mutable registry ref/session is represented by `recipientEpoch`; a revive of that epoch has one `reviveAttemptId`.

```
Recipient lifecycle

liveIdle ──parkRequested(parkAttemptId)──▶ parking ──parked──▶ parked
   ▲                                           │               │
   └──────────────parkFailed───────────────────┘               │
parked ──reviveRequested(reviveAttemptId)──▶ reviving ──revived──▶ liveIdle
reviving ──reviveFailed──▶ parked

liveIdle ──turnStarted──▶ liveRunning ──turnEnded──▶ liveIdle
liveIdle | liveRunning | parking | parked | reviving ──releaseRequested──▶ releasing ──released──▶ released
parking | parked | reviving ──recipientReplaced(new recipientEpoch)──▶ state of replacement

Per-message delivery

unseen ──reserved(captureSeq)──▶ reserved ──handedOff(method)──▶ handedOff ──consumed──▶ consumed
                                      └─deadLettered(reason)──▶ deadLettered
```

- `liveIdle`: the current recipient epoch has an attached session and no turn in progress.
- `liveRunning`: the current recipient epoch has an attached session with a turn in progress; hand-off is a non-interrupting aside.
- `parking`: one `parkAttemptId` owns journal flush and teardown. The ref is already published as parked to senders, matching the existing protection against targeting a dying idle session (`src/registry/agent-lifecycle.ts:323-378`).
- `parked`: the stable id and session file remain addressable, but no live session is attached (`src/registry/agent-registry.ts:21-27,139-151`).
- `reviving`: one coalesced `reviveAttemptId` owns admission and session reconstruction for the bound `recipientEpoch` (`src/registry/agent-lifecycle.ts:207-235,460-526`).
- `releasing`: new hand-offs are fenced while lifecycle cleanup waits for in-flight park/revive work.
- `released`: terminal for that recipient epoch. A later registry replacement is a new epoch, never a resurrection of the released identity.
- `reserved`: the full immutable envelope is durably owned by the recipient mailbox. Transient revive or hand-off failure cannot remove it.
- `handedOff`: the envelope was accepted exactly once by a matching waiter or by the current session context. This is not a claim that the recipient completed a turn (`src/irc/bus.ts:110-127`; `src/session/agent-session.ts:12827-12848`).
- `consumed`: a waiter/inbox read observed the handed-off envelope. Peek is non-transitioning.
- `deadLettered`: terminal non-delivery with a typed reason; it is never represented by deletion, log-only handling, or an untyped error string.

Ordering choice: **FIFO per `(recipientId, senderId)`, not a system-wide global capture order.** A serialized recipient mailbox assigns every reservation a unique `captureSeq` for replay and tie-breaking, but different senders MAY overtake one another. This is the strongest ordering supported by the real selective-receive seams: filtered drains choose the oldest message from that sender and filtered waits choose the oldest compatible waiter (`src/irc/bus.ts:391-418`), while local and external inboxes are captured by separate transports and merged only at the tool boundary (`src/tools/irc.ts:444-457`). A global wall-clock order would invent a distributed sequencer and make filtered waits head-of-line-block unrelated senders. H1 monitor/report events remain ordered because one logical child is one sender and its `agentSeq` is already strictly monotonic (`src/task/route-events.ts:28-39,135-147`).

## Events (every transition = one typed message to the monitor + one journal record)

Transition events are:

`parkRequested(parkAttemptId), parked, parkFailed(cause), turnStarted, turnEnded, reviveRequested(reviveAttemptId), revived(reviveAttemptId, recipientEpoch, sessionEpoch), reviveFailed(reviveAttemptId, failure), releaseRequested, released, recipientReplaced(oldRecipientEpoch, newRecipientEpoch), reserved(envelope, captureSeq, recipientEpoch), reservationRebound(messageId, oldRecipientEpoch, newRecipientEpoch), handedOff(messageId, method, recipientEpoch, sessionEpoch), consumed(messageId), deadLettered(messageId, deadLetter)`.

`deliveryDeferred(messageId, failure)`, `peeked(messageId)`, and `receiptEmitted(receipt)` are typed, non-transitioning observations. They do not advance message state or satisfy delivery.

Every event carries `recipientId`, recipient-local monotonic `seq`, logical `at`, and the identity fields required by that transition. The identical event id and payload are appended to the recipient journal and committed **before** the monitor message is emitted. A notification failure never rolls back a committed transition; the monitor replays from its last acknowledged `seq`. This extends the existing lifecycle sequence/journal seam (`src/task/route-events.ts:28-39,135-147,329-359`) and makes the existing park/revive flush-before-attach/detach ordering explicit (`src/registry/agent-lifecycle.ts:333-378,491-524`).

For the first parked reservation that starts a revival, durability precedes lifecycle and delivery work:

```
journalCommitted(reserved(m))
  happens-before monitorNotified(reserved(m))
  happens-before reviveRequested(attempt)
  happens-before revived(attempt, epoch, session)
  happens-before handedOff(m, epoch, session)
```

A later reservation may join an already-requested coalesced attempt; in that case both `journalCommitted(reserved(m))` and `reviveRequested(attempt)` independently happen-before `revived`, and `revived` happens-before `handedOff(m)`.

`handedOff` is written only after the waiter/session acceptance point. Removing a reservation is the state change represented by that same event, not a separate pre-hand-off mutation. On a retryable failure the message remains `reserved` and `deliveryDeferred` names the typed cause; on a terminal failure `deadLettered` names the typed cause. This formalizes the live code's reserve-before-revive/remove-after-success discipline (`src/irc/bus.ts:142-212`) without its silent queue-cap deletion (`src/irc/bus.ts:364-378`).

The mailbox payload is intentionally generic. An H1 monitor/report event is passed unchanged as the envelope payload: its `childId`, `seq`, `at`, `kind`, and optional `cause` remain H1-owned fields. H2 adds transport identity/order around it; it does not translate or reinterpret the H1 event. This is the co-design seam required by `docs/fable/drafts/2026-07-16-effect-migration-execution-plan.md:55-59`.

## Invariants (each becomes a checker in the model + trace conformance)

- **I1 Serialized durable observability**: for each `recipientId`, transition events have `seq(n+1) = seq(n) + 1`, the snapshot equals a left fold of its journal, and `journalCommitted(e) < monitorNotified(e)`. No lifecycle or message state changes outside that event stream. (`src/task/route-events.ts:28-39,135-147,329-359`; `src/registry/agent-lifecycle.ts:333-378,491-524`.)
- **I2 Reservation-before-revive, exact hand-off**: the first parked reservation that triggers attempt `a` satisfies `reserved(m) < reviveRequested(a)`; a reservation joining an already-active `a` may satisfy `reviveRequested(a) < reserved(m)`, but every successful path satisfies both `reserved(m) < revived(a) < handedOff(m)` and `reviveRequested(a) < revived(a)`. `count(handedOff(m)) <= 1`; a reservation is removed only by its sole `handedOff` or `deadLettered` transition, and any retryable revive/hand-off failure leaves exactly one reserved copy with the original `messageId` and `captureSeq`. The dropped-message/replacement race fixed at `CHANGELOG.md:97` is the canonical historical violation. (`src/irc/bus.ts:142-212`; `src/registry/agent-lifecycle.ts:207-235,472-481`.)
- **I3 Typed terminality; silence abolished**: a message can never disappear. At `released`, or when the configured retry/retention policy declares delivery terminal, every reservation for that recipient epoch has exactly one terminal state: `handedOff` or `deadLettered`, never both. Every dead letter carries a closed `H2FailureCode`, retryability, message/recipient identity, and cause; queue pressure is a dead letter, not eviction plus a debug log. HR-136's swallowed revived-child result/error and the current cap's silent oldest-drop are canonical violations. (`docs/fable/harness-request-register.md:128`; `CHANGELOG.md:75`; `src/irc/bus.ts:364-378`.)
- **I4 Per-sender FIFO**: for messages `m1,m2` with the same recipient and sender, `captureSeq(m1) < captureSeq(m2)` implies `terminalSeq(m1) < terminalSeq(m2)` whenever both become terminal. Different senders have no hand-off-order guarantee; `captureSeq` remains unique and monotonic for replay. Filtered receive may bypass another sender but never an earlier message from the selected sender. (`src/irc/bus.ts:391-418`; `src/tools/irc.ts:425-457`.)
- **I5 Replacement fencing and reservation following**: every `handedOff` names the current `recipientEpoch` and attached `sessionEpoch`. A revive completion for an older ref/adopted/session identity cannot attach or hand off and its session is disposed. A still-addressable replacement receives `reservationRebound` with the original message id/order and a fresh revive attempt; if no replacement is addressable, the reservation becomes typed `recipient_released`. The `released or replaced while reviving` incident is canonical. (`CHANGELOG.md:97`; `src/registry/agent-lifecycle.ts:483-519`; `src/registry/agent-registry.ts:82-158`.)
- **I6 Release-while-reviving correctness**: once `releaseRequested(epoch)` is serialized, no later event may attach or hand off through that epoch. Release waits for the coalesced park/revive attempt, disposes at most one attached/reconstructed session, releases timer/subscription/admission ownership once, and reaches `released` with no nonterminal reservation: reservations rebind under I5 or dead-letter as `recipient_released`. (`src/registry/agent-lifecycle.ts:239-272,460-526`.)
- **I7 Park-TTL/revive serialization**: `parkRequested(parkAttemptId)` and `reserved(messageId)` have one serialized order. If reservation wins, the stale TTL attempt cannot detach that session; if park wins, it publishes `parking`, commits `parked`, then revival may start. A late park completion may act only when adopted identity, ref identity, session identity, status, and attempt id still match. Thus the race yields either live hand-off or park-then-revive, never hand-off to a session being disposed. (`src/registry/agent-lifecycle.ts:323-381`; `src/irc/bus.ts:135-173`.)
- **I8 Revive coalescing and admission ownership**: for one `(recipientId, recipientEpoch)`, at most one `reviveAttemptId` is in flight. Concurrent reservations share it. Live-child admission is acquired while the ref is parked and before session reconstruction; success holds that slot until park/release, while every failure or fenced attempt releases it exactly once. Revival cannot bypass the FIFO live-child bound. (`src/registry/agent-lifecycle.ts:99-106,207-235,460-526`; `CHANGELOG.md:57`.)
- **I9 Revival configuration fidelity**: `revived` is legal only when the reconstructed session's frozen configuration fingerprint equals the parked epoch's fingerprint. Tool inventory distinguishes policy-default (`undefined`) from explicit names (including explicit empty); revival must preserve that distinction and the exact explicit names. HR-136's “undefined full capability became empty allowlist” is the canonical violation. (`CHANGELOG.md:75`; `src/task/executor.ts:154-155,881-907,958-971,2463-2480`; `docs/fable/harness-request-register.md:128`.)
- **I10 Selective-wait correctness**: a draining wait consumes the oldest reserved message matching `from`; `drainPending:false` consumes no pre-existing reservation; a send resolves the oldest compatible waiter and never a nonmatching waiter. Timeout/abort removes exactly that waiter and consumes no message. (`src/irc/bus.ts:215-284,391-418`; `src/tools/irc.ts:321-423`.)
- **I11 Receipt honesty and transport fencing**: `injected | woken | revived` is emitted only after `handedOff` with that method. `failed` carries a typed failure plus `disposition: reserved | deadLettered`; it never implies recipient work completion. An unavailable local peer in a subprocess worker yields `subprocess_loopback_refused` and MUST NOT fall through to the external bus. HR-163's loopback path is the canonical violation. (`src/irc/bus.ts:38-60,175-212`; `src/tools/irc.ts:289-319,369-418`; `CHANGELOG.md:76`.)
- **I12 Broadcast non-stampede**: broadcast captures only visible `running | idle` recipients at command serialization; it never parks a future waiter and never revives a parked recipient. Direct addressing is the only tool path that may reserve-and-revive. (`src/tools/irc.ts:280-287,352-367`.)
- **I13 Projection isolation**: roster snapshots and Main UI relay are non-authoritative projections. Their failure, lag, or cross-snapshot skew cannot mutate reservation state, receipt outcome, or lifecycle state; authoritative recovery reads journaled mailbox/lifecycle events. (`src/irc/bus.ts:300-362,420-445`; `src/tools/irc.ts:193-225`; `CHANGELOG.md:18`.)
- **I14 Payload transparency for H1**: for any accepted H1 event `e`, `handedOff(envelope).payload === e`; H2 neither renumbers H1's `seq` nor rewrites `childId`, `kind`, `at`, or `cause`. H2 transport ids and sequences live only on the envelope/event. This keeps H1's durability/monitor vocabulary consumable without an adapter. (`streams/harness/migration/CONTRACTS/h1-child-lifecycle.md:27-31,63-71`; `docs/fable/drafts/2026-07-16-effect-migration-execution-plan.md:55-59`.)

## Faults the DST driver MUST inject (each mapped to the invariant it attacks)

| Fault | Attacks |
|---|---|
| crash/restart before and after every journal commit and monitor notification; duplicate/reorder/delay monitor messages | I1, I2, I3, I13 |
| two sends of the same message id; retry after lost receipt; hand-off succeeds but acknowledgement is dropped | I2, I3, I11 |
| concurrent sends from one sender and from different senders; selective `from` waits interleaved with inbox drains | I4, I10 |
| revival failure before admission, after admission, after session reconstruction, and after lifecycle flush | I2, I3, I8, I11 |
| replace the registry ref/session immediately before and after each revive identity check and persistence boundary | I2, I5, I8 |
| `releaseRequested` at every revive/park await; late revive success after release; replacement arrives during release | I3, I5, I6, I8 |
| park TTL one step before/after reservation; delayed old park dispose after a replacement attaches | I2, I5, I7 |
| two simultaneous direct sends to one parked epoch; cancel the shared admission waiter; exhaust the parent's live-child slots | I2, I8 |
| revive with policy-default tools, explicit empty tools, and nonempty explicit tools; mutate/reorder one frozen name | I9 |
| fill mailbox at its capacity while revival is delayed; fail the oldest and newest hand-offs; exhaust retention policy | I2, I3, I4 |
| timeout/abort waiter at each registration/removal boundary; install filtered and unfiltered waiters in both orders | I4, I10 |
| subprocess worker targets an absent local peer whose name exists on the external bus | I11 |
| broadcast with only parked peers and with live plus parked peers; registry changes during target capture | I12 |
| throw/delay/drop Main relay; skew registry and delivery-summary snapshots; restart monitor from an acknowledged sequence | I1, I13 |
| carry every H1 event variant through reserve/revive/hand-off; perturb only H2 envelope fields and attempt payload mutation | I4, I14 |

## Known intentional divergences from current behavior (seed rows for DIVERGENCES.md)

1. **Durable mailbox, not process memory** (cites I1/I2): `reserved`, lifecycle, hand-off, and dead-letter transitions are replayable after owner restart; current mailbox/delivery maps are memory-only (`src/irc/bus.ts:96-107,323-389`).
2. **Capacity failure is explicit** (cites I3): exceeding retention produces a typed `mailbox_capacity` dead letter under the selected policy; current behavior shifts the oldest message and only debug-logs it (`src/irc/bus.ts:364-378`).
3. **Failure has typed disposition** (cites I3/I11): a failed receipt says whether the message remains `reserved` or is `deadLettered`, with a closed failure code; current `failed` carries only an optional string while the record may still have a buffered copy (`src/irc/bus.ts:38-60,165-170,201-211`).
4. **Hand-off is not consumption** (cites States/I11): session/waiter acceptance and recipient consumption are distinct observations; the current direct-session path marks `delivered` and then `read` in the same send call (`src/irc/bus.ts:175-200`).
5. **All protocol transitions are monitor-replayable** (cites I1/I13): display relay remains non-authoritative, but the monitor can reconstruct every transition from the journal; current Main relay is best-effort and failures are log-only (`src/irc/bus.ts:420-445`).
6. **TTL/revive winner is the serialized command order** (cites I7): the model records whether reservation or `parkRequested` won and fences the loser by attempt/epoch; current correctness is spread across early status publication, map coalescing, and post-await object-identity checks (`src/registry/agent-lifecycle.ts:99-106,323-381,460-526`).

## Interface freeze for parallel workers (build against this, exactly)

```ts
// test/migration/model/h2-model.ts (pure, no IO, no Date.now)
export type H2RecipientStateName =
	| "liveIdle"
	| "liveRunning"
	| "parking"
	| "parked"
	| "reviving"
	| "releasing"
	| "released";
export type H2MessageStateName = "reserved" | "handedOff" | "consumed" | "deadLettered";
export type H2DeliveryMethod = "injected" | "woken" | "revived";
export type H2Origin = "user" | "agent" | "system";
export type H2FailureCode =
	| "unknown_recipient"
	| "recipient_aborted"
	| "non_revivable"
	| "recipient_released"
	| "recipient_replaced"
	| "revive_failed"
	| "handoff_failed"
	| "mailbox_capacity"
	| "subprocess_loopback_refused";

export type H2ToolInventory =
	| { readonly kind: "policyDefault" }
	| { readonly kind: "explicit"; readonly names: readonly string[] };

export interface H2Failure {
	readonly code: H2FailureCode;
	readonly retryable: boolean;
	readonly detail?: string;
}
export type H2DeadLetter = Omit<H2Failure, "retryable"> & {
	readonly retryable: false;
	readonly messageId: string;
	readonly recipientId: string;
	readonly recipientEpoch: number;
};
export interface H2Envelope<Payload = unknown> {
	readonly messageId: string;
	readonly senderId: string;
	readonly recipientId: string;
	readonly captureSeq: number;
	readonly origin: H2Origin;
	readonly payload: Payload;
	readonly replyTo?: string;
}
export type H2Receipt =
	| { readonly messageId: string; readonly to: string; readonly outcome: H2DeliveryMethod }
	| {
			readonly messageId: string;
			readonly to: string;
			readonly outcome: "failed";
			readonly disposition: "reserved";
			readonly failure: H2Failure;
	  }
	| {
			readonly messageId: string;
			readonly to: string;
			readonly outcome: "failed";
			readonly disposition: "deadLettered";
			readonly deadLetter: H2DeadLetter;
	  };

interface H2EventBase {
	readonly recipientId: string;
	readonly seq: number;
	readonly at: number; // supplied logical/TestClock time
}
export type H2Event<Payload = unknown> =
	| (H2EventBase & { readonly kind: "parkRequested"; readonly parkAttemptId: string })
	| (H2EventBase & { readonly kind: "parked"; readonly parkAttemptId: string })
	| (H2EventBase & { readonly kind: "parkFailed"; readonly parkAttemptId: string; readonly failure: H2Failure })
	| (H2EventBase & { readonly kind: "turnStarted" | "turnEnded"; readonly sessionEpoch: number })
	| (H2EventBase & {
			readonly kind: "reviveRequested";
			readonly reviveAttemptId: string;
			readonly recipientEpoch: number;
	  })
	| (H2EventBase & {
			readonly kind: "revived";
			readonly reviveAttemptId: string;
			readonly recipientEpoch: number;
			readonly sessionEpoch: number;
			readonly configFingerprint: string;
			readonly toolInventory: H2ToolInventory;
	  })
	| (H2EventBase & {
			readonly kind: "reviveFailed";
			readonly reviveAttemptId: string;
			readonly recipientEpoch: number;
			readonly failure: H2Failure;
	  })
	| (H2EventBase & { readonly kind: "releaseRequested" | "released"; readonly recipientEpoch: number })
	| (H2EventBase & {
			readonly kind: "recipientReplaced";
			readonly oldRecipientEpoch: number;
			readonly newRecipientEpoch: number;
			readonly replacementState: "liveIdle" | "liveRunning" | "parked";
	  })
	| (H2EventBase & {
			readonly kind: "reserved";
			readonly envelope: H2Envelope<Payload>;
			readonly recipientEpoch: number;
	  })
	| (H2EventBase & {
			readonly kind: "reservationRebound";
			readonly messageId: string;
			readonly oldRecipientEpoch: number;
			readonly newRecipientEpoch: number;
	  })
	| (H2EventBase & {
			readonly kind: "handedOff";
			readonly messageId: string;
			readonly method: H2DeliveryMethod;
			readonly recipientEpoch: number;
			readonly sessionEpoch: number;
	  })
	| (H2EventBase & { readonly kind: "consumed" | "peeked"; readonly messageId: string })
	| (H2EventBase & { readonly kind: "deliveryDeferred"; readonly messageId: string; readonly failure: H2Failure })
	| (H2EventBase & { readonly kind: "deadLettered"; readonly messageId: string; readonly deadLetter: H2DeadLetter })
	| (H2EventBase & { readonly kind: "receiptEmitted"; readonly receipt: H2Receipt });

export interface H2MessageSnapshot<Payload = unknown> {
	readonly envelope: H2Envelope<Payload>;
	readonly state: H2MessageStateName;
	readonly boundRecipientEpoch: number;
	readonly handedOffBy?: H2DeliveryMethod;
	readonly deadLetter?: H2DeadLetter;
}
export interface H2Snapshot<Payload = unknown> {
	readonly recipientId: string;
	readonly recipientState: H2RecipientStateName;
	readonly recipientEpoch: number;
	readonly sessionEpoch?: number;
	readonly configFingerprint: string;
	readonly toolInventory: H2ToolInventory;
	readonly seq: number;
	readonly activeParkAttemptId?: string;
	readonly activeReviveAttemptId?: string;
	readonly journal: readonly H2Event<Payload>[];
	readonly messages: ReadonlyMap<string, H2MessageSnapshot<Payload>>;
}
export type H2Invariant =
	| "I1" | "I2" | "I3" | "I4" | "I5" | "I6" | "I7"
	| "I8" | "I9" | "I10" | "I11" | "I12" | "I13" | "I14";
export interface H2Violation<Payload = unknown> {
	readonly invariant: H2Invariant;
	readonly detail: string;
	readonly event: H2Event<Payload>;
}
export type H2StepResult<Payload = unknown> =
	| { readonly ok: true; readonly next: H2Snapshot<Payload> }
	| { readonly ok: false; readonly violation: H2Violation<Payload> };
export function h2Step<Payload>(
	snapshot: H2Snapshot<Payload>,
	event: H2Event<Payload>,
): H2StepResult<Payload>;
export function h2CheckTrace<Payload>(
	events: readonly H2Event<Payload>[],
): readonly H2Violation<Payload>[];
```

The compile-time co-design assertion is `H2Envelope<H1Event>`: no H1 adapter type is permitted. Attempt ids, epochs, `seq`, `captureSeq`, `at`, failure details, and policy decisions are test inputs; the pure model never allocates ids, reads clocks, opens journals, or performs delivery.

## DRAFT caveats and open questions for Arthur

The clauses above are the proposed contract, not authorization to port. Arthur's read must resolve these taste/policy choices before any H2 packet spawns:

1. **Ordering** — approve I4's per-sender FIFO with unconstrained cross-sender overtaking, or pay for recipient-global FIFO and its selective-receive head-of-line blocking. The current seams support the former; there is no cross-transport sequencer (`src/irc/bus.ts:391-418`; `src/tools/irc.ts:444-457`).
2. **Retention/retry bound** — choose the deterministic point at which a retryable reservation becomes `deadLettered` (attempt count, logical age, explicit release only, or a combination) and the mailbox capacity. I3 fixes the safety rule—never delete silently—but not these policy constants.
3. **Public failed-receipt shape** — approve preserving public outcome `failed` plus typed `disposition`, versus promoting `deadLettered` to a fifth top-level outcome. The freeze preserves the real four-outcome vocabulary while making terminality explicit (`src/irc/bus.ts:38-60`).
4. **Replacement trust boundary** — confirm that a same stable id registered as a new ref is sufficient for `reservationRebound`, or require lineage/session-file proof before following it. Current code follows a changed parked ref by object identity and preserves stable spawn index (`src/irc/bus.ts:149-164`; `src/registry/agent-registry.ts:82-101`).
5. **Meaning of `consumed`** — approve `handedOff` as successful delivery for session context and reserve `consumed` for an observable waiter/inbox read. The model cannot truthfully claim that a model turn semantically acted on a fire-and-forget prompt (`src/session/agent-session.ts:12827-12884`).
6. **Configuration fingerprint scope** — I9 requires the full frozen revival configuration to match; approve whether the fingerprint includes only tools plus model/thinking/output schema, or also prompt/settings snapshots. The live descriptor freezes all of these families (`src/task/executor.ts:881-907,926-971`).
7. **Journal ownership** — choose whether mailbox events live in the recipient session journal, a parent/session-control journal, or a dedicated mailbox journal. It must survive a parked session and owner restart and preserve I1's one sequence; current lifecycle events are session-journal entries while bus state is memory-only (`src/task/route-events.ts:329-359`; `src/irc/bus.ts:96-107`).
8. **External-bus boundary** — confirm that H2 governs local/coordinator mailboxes only and external IRC remains a separately durable, fire-and-forget transport, while still sharing origin and typed refusal vocabulary. External `await:true` is currently forbidden and subprocess loopback is refused (`src/tools/irc.ts:289-319`; `docs/fable/harness-request-register.md:45,130`).
9. **Monitor delivery topology** — approve journal replay as the authority when the monitor mailbox is unavailable, avoiding recursive “monitor the monitor notification” acknowledgements. I1 requires durability before notification but deliberately does not require the source transition to roll back on monitor failure.

Until those rulings are recorded, the interface is frozen only as a review target and the H2 port remains hard-gated.
