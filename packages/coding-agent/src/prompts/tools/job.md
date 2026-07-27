Inspects, waits, interrupts, cancels async jobs, resolves fallback proposals, or hot-swaps the current Main session or a direct child's model.

Background job results are delivered automatically when complete. Reach for this tool only when you need to intervene. Interrupt stops a subagent's current turn but keeps it alive for follow-up; cancel kills abandoned/stalled work. Model swaps apply immediately when the target is idle, otherwise at the next safe turn boundary; the target is told that it was swapped.

# Operations

## `list: true`
Use to inspect what's running.

## `poll: [id, …]`
Block until the specified jobs finish or the wait window elapses. Omit `poll` (with no `list`/`cancel`/`interrupt`) to wait on ALL running jobs — NEVER enumerate ids you don't need to filter.
- Use when you are genuinely blocked on a result and have no other work to do.
- Returns the current snapshot when the timer elapses; running jobs remain running.
- Completed jobs include their final output in the returned snapshot.
- With Max Poll Time set to `smart` (the default), the wait window adapts: it starts at ~5s and lengthens with each back-to-back poll (up to ~5m), then resets to ~5s after you go a while without polling. Spinning in a poll loop costs progressively more; do real work between polls.

## `cancel: [id, …]`
Stop running jobs.
- Use when a job is stalled, hung, or no longer needed.
- Returns immediately after cancelling.


## `interrupt: [id, …]`
Stop the current turn but keep the subagent alive.
- Use when you need the agent to stop now and remain irc-addressable for follow-up.
- Optional `interruptReason` is delivered to the agent's next turn.
- Returns immediately after requesting the interrupt.

## `fallbackApproval: { id, action, timeoutMs?, model? }`
Resolve a fallback proposal from a failing direct child without respawning it.
- `action: "wait"` retries the source model after `timeoutMs` (default 60000).
- `action: "approve"` applies the proposed model.
- `action: "choose"` requires an explicit `model` selector.
- `action: "abort"` ends the pending retry.
- Approval preserves the stable child id and conversation context.

## `setModel: { id, model, reason? }`
Swap the current Main session or a live, parked, or historical direct child's model.
- `id` is `Main` for the current Main session, or a stable spawned-agent id. Historical ids are resolved only within this session's durable direct-child journals.
- `model` is a provider/model selector, fuzzy selector, role, or selector with `:<thinking>` suffix.
- `reason` is optional; live targets receive it in their next-turn notice and historical targets retain it in route metadata.
- The swap is restricted to the current Main session or direct children you own, preserves conversation context, and never triggers an extra turn.
