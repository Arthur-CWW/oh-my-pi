> Rescued 2026-07-13 from /Users/arthur/agents/local/cross-session-command-contract.md

# Cross-session command contract (`cmd/1`)

Status: implementation-ready design for the existing external IRC bus. This document freezes the v1 wire format, policy, dispatch, audit, replay, and ownership boundaries. It adds no CLI, transport, or database schema.

## 1. Security and scope

The external IRC bus is a machine-local SQLite database. `from_peer` is caller-supplied and is not authenticated; any process able to write the database can impersonate a peer. Therefore:

- `irc.commands` is a receiving-side policy with values `off | ask | allow`.
- The default is **`ask`**.
- `allow` is an explicit operator opt-in. It must never be inferred from tool approval mode, sender name, localhost, peer freshness, or a previous approval.
- `ask` approves one request only. It never persists a sender allow-list or changes `irc.commands`.
- Only a receiving **main** `AgentSession` decodes and dispatches commands. Subagent sessions do not register/poll the external bus and must not acquire a command path.
- V1 commands are exactly `setModel`, `interrupt`, and `status`.
- No new `omp` CLI subcommand or flag is added. A sender uses the existing `omp irc send <peer> '<json>' [--from <name>]`, and reads replies with the existing `omp irc inbox <from-name>`.
- No change is made to `IrcExternalBus`, its SQLite schema, normal IRC messages, or the in-process `IrcBus` protocol.

## 2. Request envelope

A command request is UTF-8 JSON stored verbatim in `IrcExternalMessage.body`:

```ts
type IrcCommandRequest =
  | {
      omp: "cmd/1";
      id: string;
      cmd: "setModel";
      args: { model: string };
    }
  | {
      omp: "cmd/1";
      id: string;
      cmd: "interrupt";
      args: Record<string, never>;
    }
  | {
      omp: "cmd/1";
      id: string;
      cmd: "status";
      args: Record<string, never>;
    };
```

Examples:

```json
{"omp":"cmd/1","id":"01JZ9R6ZV6M8T4AQVJ7QK3Y2DD","cmd":"setModel","args":{"model":"openai-codex/gpt-5.6-sol"}}
```

```json
{"omp":"cmd/1","id":"01JZ9R79HPK74BWRWSGWPGJ4P2","cmd":"interrupt","args":{}}
```

```json
{"omp":"cmd/1","id":"01JZ9R7GWA8D4E7BRJFY5SSBTX","cmd":"status","args":{}}
```

### 2.1 Exact decoder rules

The decoder is a pure function in `src/irc/command-protocol.ts`:

```ts
export function decodeIrcCommand(body: string): IrcCommandRequest | undefined;
```

It returns a request only when every rule below holds. Otherwise it returns `undefined`; it never throws.

1. `JSON.parse(body)` succeeds and yields a plain, non-null, non-array object.
2. The top-level own keys are exactly `omp`, `id`, `cmd`, and `args` (key order is irrelevant). No extra keys are accepted in v1.
3. `omp === "cmd/1"`.
4. `id` is a string, is already trimmed, has length 1–128 UTF-16 code units, and contains no C0 control character (`U+0000`–`U+001F`) or DEL (`U+007F`). The decoder does not normalize or lowercase it.
5. `cmd` is exactly one of the three command names.
6. `args` is a plain, non-null, non-array object.
7. For `status` and `interrupt`, `args` has no own keys.
8. For `setModel`, `args` has exactly the own key `model`; `model` is a string, is already trimmed, has length 1–256, and has the fully-qualified form `<provider>/<model-id>` with non-empty text on both sides of the first slash. Thinking suffixes, role names, bare model IDs, and persistence flags are not part of v1.

The decoder must use ordinary own enumerable keys (`Object.keys`) and must not accept inherited fields. It does not mutate or retain the parsed object; return a newly constructed discriminated object so downstream code cannot observe prototypes or extra input state.

### 2.2 Malformed and future envelopes degrade to text

Any parse failure or validation failure—including a JSON object with `omp: "cmd/1"` but an unknown command, missing/extra field, bad ID, or bad args—follows the pre-existing plain-text IRC path unchanged:

- create the normal `irc:incoming` custom message,
- enqueue it as an IRC aside,
- mark the bus row delivered,
- send no command result automatically.

This rule is deliberate compatibility behavior. Old binaries and future/unknown protocol versions render the body as text instead of partially executing it. The command dispatcher must therefore be entered only for a successful decoder result.

## 3. Receiving policy

Add this setting adjacent to the existing `irc.timeoutMs` and `irc.peerName` schema entries:

```ts
"irc.commands": {
  type: "enum",
  values: ["off", "ask", "allow"] as const,
  default: "ask",
  ui: {
    tab: "tools",
    group: "Execution",
    label: "IRC Commands",
    description: "Control command requests received over the unauthenticated machine-local IRC bus. Ask prompts for each request; Allow executes without prompting.",
    options: [
      { value: "off", label: "Off" },
      { value: "ask", label: "Ask" },
      { value: "allow", label: "Allow" },
    ],
  },
}
```

Policy is read when each distinct request is handled, not cached at session construction.

- `off`: do not prompt and do not dispatch. Produce a terminal failure with code `disabled`.
- `allow`: dispatch directly.
- `ask`: request one interactive approval before dispatch.

### 3.1 `ask` flow

Use the same UI seam as existing approval flows: `this.#extensionRunner?.hasUI()` and `getUIContext().select(...)`. Do not invoke the `AskTool` through the model and do not start an LLM turn.

The prompt is:

```text
IRC command request from "<fromPeer>" (sender identity is unauthenticated)
<summary>
```

Summaries are exact:

- `setModel`: `Set this session model to <provider/model>.`
- `interrupt`: `Interrupt the current run and keep the session alive.`
- `status`: `Return this session's current status.`

Options are exactly `Approve once` and `Deny`; only `Approve once` approves. If no interactive UI exists, the selector throws/aborts, the session is disposed while waiting, or the selector yields any other value, fail closed. No dispatch occurs. Explicit `Deny` returns code `denied`; unavailable/aborted UI returns code `approval_unavailable`.

Command approval selectors are serialized FIFO with one session-local promise tail. This is required because the selector surface is singular and concurrent prompts clobber each other. Serialization covers policy re-read and approval, but a previously queued command still uses the setting value observed when its own queue position begins.

The selector may be shown while the model is streaming; otherwise an `interrupt` request could not be approved when it is needed. Approval work must not block the synchronous aside provider or the IRC poll loop.

## 4. Dispatch semantics

A successfully decoded request is a control record, not model context. It must not also become `irc:incoming` and must not be pushed into `#pendingIrcAsides`.

Dispatch remains inside the receiving `AgentSession`; it reuses existing public session operations.

### 4.1 `setModel`

1. Read `this.getAvailableModels()`.
2. Match only exact `${model.provider}/${model.id} === request.args.model`.
3. If no exact match exists, fail with `unknown_model`; do not use fuzzy matching, a bare-ID fallback, role resolution, or the registry's first partial match.
4. Call `await this.setModel(match)` with the normal default role and without `{ persist: true }`.
5. Success result is `{ "model": "<provider/model>" }` using the matched model's canonical provider and ID.

This changes the active session and writes the existing model-change session entry, but does not rewrite global/project settings.

### 4.2 `interrupt`

Capture `wasActive = this.isStreaming || this.queuedMessageCount > 0`, then call:

```ts
await this.abort({ goalReason: "interrupted", reason: USER_INTERRUPT_LABEL });
```

The session remains registered and alive. It is not disposed, released, shut down, or switched. Success result is `{ "interrupted": wasActive }`; an idle interrupt is a successful idempotent no-op with `interrupted: false`.

### 4.3 `status`

Do not mutate the session. Return this exact result shape:

```ts
{
  peer: string;                    // receiving external peer name
  sessionId: string;               // this.sessionId
  state: "working" | "idle";      // this.isStreaming ? "working" : "idle"
  model: string | null;            // provider/id, or null when no model is selected
  queuedMessages: number;          // this.queuedMessageCount
}
```

`status` reports the live session, not tail-derived discovery status. Approval bookkeeping does not itself make `state` working.

## 5. Result envelope and sender semantics

Every valid command request receives a terminal result, including `off`, denial, approval failure, dispatch failure, and a replay. Results use a different discriminator so they can never be decoded as requests:

```ts
type IrcCommandResult =
  | {
      omp: "cmd/1/result";
      id: string;
      cmd: "setModel" | "interrupt" | "status";
      ok: true;
      result: Record<string, unknown>;
    }
  | {
      omp: "cmd/1/result";
      id: string;
      cmd: "setModel" | "interrupt" | "status";
      ok: false;
      error: {
        code:
          | "disabled"
          | "denied"
          | "approval_unavailable"
          | "unknown_model"
          | "execution_failed"
          | "incomplete_previous_attempt";
        message: string;
      };
    };
```

Successful and failed variants have exactly the shown keys. Serialization is `JSON.stringify(result)`; no pretty-printing or newline is added.

Send through the existing external bus:

```ts
bus.sendMessage({
  fromPeer: receivingPeerName,
  toPeer: sourceMessage.fromPeer,
  body: JSON.stringify(result),
});
```

The reply always goes to the original row's exact `fromPeer`, even though it is unauthenticated and even if no live peer registration exists. The bus permits this, and `omp irc inbox <fromPeer>` can retrieve it. Never reply to a sender supplied inside JSON (there is no such field), never use the in-process IRC bus, and never require `findPeerByName` before replying.

Error messages are stable operator text, not stack traces:

- `disabled`: `IRC commands are disabled by the receiving session.`
- `denied`: `IRC command denied by the receiving operator.`
- `approval_unavailable`: `IRC command approval is unavailable.`
- `unknown_model`: `Model is not available in the receiving session: <selector>`
- `incomplete_previous_attempt`: `A previous attempt was claimed but did not record a result; it will not be executed again.`
- `execution_failed`: use `error.message` for an `Error`, otherwise `String(error)`; do not include a stack.

A failure to write a reply is logged but must not turn a completed command into a second execution attempt.

## 6. Idempotency and crash/replay protection

### 6.1 Identity

The idempotency key is the pair `(sourceMessage.fromPeer, request.id)`. Neither component is normalized. The same `id` from different senders is independent. `cmd` and `args` are not part of the key: if a sender reuses an ID with different content, the first claimed request wins and the later row receives the first terminal result.

The external SQLite message row ID is delivery bookkeeping only; it is not command identity.

### 6.2 Audit ledger

Persist command audit records as `custom_message` entries with:

- `customType: "irc:command"`
- `display: true`
- `attribution: "agent"`
- a concise `content` summary containing phase, sender, command, ID, and terminal outcome when present
- `details` in one of these exact shapes:

```ts
type IrcCommandAuditDetails =
  | {
      version: 1;
      phase: "claimed";
      sender: string;
      request: IrcCommandRequest;
      externalMessageId: number;
    }
  | {
      version: 1;
      phase: "completed";
      sender: string;
      request: IrcCommandRequest;
      externalMessageId: number;
      result: IrcCommandResult;
      replyBody: string;
    };
```

The original validated envelope is therefore retained with the bus sender for every execution decision. Do not store only a rendered string. The terminal entry stores the exact serialized reply for replay.

Append with `sessionManager.appendCustomMessageEntry(...)` and `await sessionManager.flush()`; the audit is direct transcript persistence, not an IRC aside and not an LLM-visible control prompt.

### 6.3 Ordering invariant

For a first-seen valid request, the order is:

1. Install the idempotency key in the in-flight map synchronously, before the first `await`.
2. Append the `claimed` audit entry and flush it.
3. Apply `off | ask | allow`; prompt if required; dispatch at most once.
4. Construct the terminal result and its exact `replyBody`.
5. Append the `completed` audit entry and flush it.
6. Send `replyBody` to the original `fromPeer`.
7. Mark the external message row delivered in `finally` after handling/reply attempt.

This deliberately prefers a safe zero-execution outcome over duplicate mutation after a crash. A process killed after the durable claim but before the durable terminal entry must not re-prompt or re-execute that key.

### 6.4 Live duplicates

Maintain a session-local map from idempotency key to the promise for its terminal `{ result, replyBody }`. Multiple bus rows for a key while the first is pending await the same promise, send the same `replyBody`, and mark their own external rows delivered. They neither prompt nor dispatch again and do not append another audit pair.

Claim external row IDs separately before starting async handlers so the synchronous poller cannot schedule the same undelivered row on every step boundary. Remove a row ID from the live-claim set only after it has been marked delivered (or after a synchronous bus failure that leaves it available for a later poll).

### 6.5 Transcript rehydration

Before handling a key not present in the live map, scan/cache `sessionManager.getBranch()` entries with `type === "custom_message"`, `customType === "irc:command"`, `details.version === 1`, and matching sender/request ID:

- If a valid `completed` entry exists, resend its exact stored `replyBody`; do not append audit, prompt, or dispatch.
- If only a valid `claimed` entry exists, construct `incomplete_previous_attempt`, append/flush a `completed` entry for that original request, cache it, reply, and do not prompt or dispatch.
- Ignore malformed/unrecognized audit details rather than trusting them as replay state.

Rebuild or invalidate this cache after `switchSession`, because the active transcript/branch changed. Branch scope is intentional: a command claim on an abandoned branch does not reserve the ID in the newly active branch.

### 6.6 Delivery failure boundaries

- Decoder-invalid input follows ordinary text delivery and has no command claim.
- If durable claim persistence fails, do not dispatch. Log the error and leave the bus row undelivered for retry.
- Once a durable claim exists, any approval/dispatch exception becomes a durable terminal failure.
- If terminal audit persistence fails, do not send a success and do not mark the row delivered; retry recovery sees the durable claim and resolves it as `incomplete_previous_attempt`, never re-executing.
- After the terminal audit is durable, a crash before reply or `markDelivered` is safe: replay resends the stored reply without execution.

The guarantee is durable **at-most-once dispatch per `(fromPeer, id)` on the active transcript branch**, not exactly-once success. The audit-before-effect ordering is the safety boundary.

## 7. Poll integration

Refactor only the body of `AgentSession.#pollExternalIrcMessages()` plus private helpers/fields adjacent to the existing IRC fields and polling helpers.

For each polled row in ascending bus ID order:

1. Skip a row ID already claimed by a live async handler.
2. Decode `message.body`.
3. If decoding returns `undefined`, run the existing `irc:incoming` construction/enqueue/mark-delivered path byte-for-byte in behavior.
4. If decoding succeeds, claim the row synchronously and start the serialized async command handler with `void`; attach a catch that logs. Do not block or make the aside provider asynchronous.
5. The command handler owns terminal reply and `markDelivered` ordering.

The poller must continue processing later rows even while an approval is pending. Approval presentation/dispatch is FIFO, while malformed text messages retain normal immediate delivery.

Disposal behavior: a command already durably claimed but not completed when disposal begins must fail closed. It may record `approval_unavailable` if the handler is still alive; otherwise transcript recovery produces `incomplete_previous_attempt`. It must never execute after `#isDisposed` becomes true.

## 8. Focused behavioral tests

Tests assert behavior, not internal helper names.

### Decoder tests (`test/tools/irc-command-protocol.test.ts`)

1. Accept each of the three exact request shapes.
2. Preserve ID and fully qualified model text exactly.
3. Return `undefined` for invalid JSON, null, arrays, primitives, wrong version, response envelopes, unknown command, missing/extra top-level keys, inherited-only fields, invalid/extra args, bad IDs, bare model IDs, and padded model strings.
4. Prove the returned value is a fresh plain discriminated object, not the parsed input/prototype.

### Settings tests (`test/settings-manager.test.ts`)

1. `getDefault("irc.commands")` and `Settings.isolated().get("irc.commands")` are `ask`.
2. `getEnumValues("irc.commands")` is exactly `["off", "ask", "allow"]`.

### Dispatch/integration tests (`test/tools/irc-external.test.ts`)

Use an in-memory/temp external bus and an `AgentSession` harness with focused spies/fakes already used by session tests; do not add a CLI surface.

1. Malformed/unknown `cmd/1` bodies become one ordinary `irc:incoming` and are marked delivered, with no result row.
2. `off` never selects or dispatches, writes claimed+completed audit, returns `disabled`, and consumes the row.
3. Default `ask` approves once and dispatches; denial and missing UI fail closed with their exact codes.
4. Two simultaneously queued approvals do not overlap selector calls and retain bus order.
5. `allow setModel` requires exact provider/model, calls the session model path without global persistence, and returns the canonical model; unavailable models return `unknown_model` without mutation.
6. `allow interrupt` uses the user-interrupt abort path, keeps the session alive, and reports active versus idle accurately.
7. `allow status` returns the exact live shape and performs no session mutation.
8. Valid commands never create `irc:incoming` or enter pending asides.
9. Results are sent from the receiving peer to the row's exact `fromPeer`, including an unregistered CLI sender name.
10. Duplicate rows with the same `(fromPeer, id)` while pending share one prompt/dispatch and receive byte-identical terminal replies.
11. A completed transcript audit survives handler/cache reconstruction and replays the byte-identical reply without prompt/dispatch.
12. A durable claim without completion becomes `incomplete_previous_attempt` without prompt/dispatch.
13. The same ID from two different senders dispatches independently; reusing an ID with altered cmd/args does not redispatch.
14. Claim-flush failure prevents dispatch and leaves the source row unread; terminal-flush failure after an effect never causes that effect to run again on recovery.

## 9. Exact disjoint implementation slices

These slices are intentionally non-overlapping so two workers can proceed concurrently after any current `agent-session.ts` owner clears.

### Worker A — protocol and setting (owns only these files)

1. **Create** `vendor/oh-my-pi/packages/coding-agent/src/irc/command-protocol.ts`
   - request/result/audit types
   - `decodeIrcCommand`
   - result serialization/build helpers only if they remain pure and session-independent
2. **Edit** `vendor/oh-my-pi/packages/coding-agent/src/config/settings-schema.ts`
   - add `irc.commands` exactly as §3
3. **Create** `vendor/oh-my-pi/packages/coding-agent/test/tools/irc-command-protocol.test.ts`
   - decoder matrix in §8
4. **Edit** `vendor/oh-my-pi/packages/coding-agent/test/settings-manager.test.ts`
   - default and enum assertions only

Worker A does not touch `agent-session.ts`, `bus-external.ts`, the CLI, or `irc-external.test.ts`.

### Worker B — dispatch, replay, and focused integration (owns only these files)

1. **Edit** `vendor/oh-my-pi/packages/coding-agent/src/session/agent-session.ts`
   - import protocol types/helpers and `USER_INTERRUPT_LABEL` is already imported
   - add private external-command row claims, in-flight/cache, and serialized approval tail adjacent to existing IRC fields
   - split normal-text conversion from command handling as private helpers
   - integrate decoding at `#pollExternalIrcMessages`
   - add approval, dispatch, audit/flush, reply, replay rehydration, and cache invalidation around session switch
2. **Edit** `vendor/oh-my-pi/packages/coding-agent/test/tools/irc-external.test.ts`
   - focused dispatch/integration cases in §8

Worker B does not touch the new protocol file, settings schema/tests, `bus-external.ts`, or any CLI file. If test construction makes the existing `irc-external.test.ts` unsuitable, Worker B may create one new `test/tools/irc-command-dispatch.test.ts` instead, but must then leave `irc-external.test.ts` untouched; it must not own both merely for convenience.

### Explicitly unowned / unchanged

- `vendor/oh-my-pi/packages/coding-agent/src/irc/bus-external.ts`
- `vendor/oh-my-pi/packages/coding-agent/src/cli/irc-cli.ts`
- CLI command registration and help
- in-process IRC bus/tool protocol
- SQLite migrations/schema
- control-plane package

## 10. Cutover invariants

Implementation is complete only when all are true:

- Plain IRC behavior is unchanged for every body that is not an exactly valid `cmd/1` request.
- `ask` is the schema-derived default and fails closed without UI.
- `allow` is the only non-interactive mutation mode.
- Valid commands are control records and never reach model context as incoming chat.
- Each first-seen valid key has a durable sender+envelope claim before prompt/effect and a durable terminal audit before reply/delivery acknowledgement.
- A key is never prompted or dispatched twice, including duplicate bus rows and transcript-backed replay.
- Every terminal path produces the versioned result envelope when persistence permits.
- `setModel` is session-only and exact-match; `interrupt` is user-semantic and keep-alive; `status` is read-only.
- No compatibility alias, alternate envelope, extra command, new transport, or new CLI is left behind.
