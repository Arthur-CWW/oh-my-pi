Sends short text messages to agents in this process or other OMP sessions on this machine and receives theirs.

<payload_discipline>
**IRC bodies carry references, not payloads.** Send a pointer plus a short sentence of intent — never the content itself.
- Findings, inventories, transcripts, file contents, command output, dataset or document descriptions, and long summaries MUST be written to a file; send its path: `local://<name>`, `artifact://<id>`, or `history://<id>`.
- Keep direct-message bodies at or below 1200 characters and broadcast bodies at or below 400 characters. The bus may refuse a send over either cap.
- A delivered body is injected verbatim into the RECIPIENT's context and persists in its history. A large pasted body can trip a provider safety classifier in the RECIPIENT's context and permanently break that session; retry does not recover it.
- A refused send is not a transport hiccup; NEVER retry blindly. Read the error, write the content to a file, and send its path instead.
</payload_discipline>

<instruction>
- Main agent is `Main`; subagents reuse their task id (`AuthLoader`, or `AuthLoader-2` when the name repeats).
- `op: "list"` — peers with status (`running` | `idle` | `parked`), unread count, parent, last activity. Use when unsure who exists.
- `op: "send"` — fire-and-forget `message` to `to` (an exact peer id; `"all"` is the restricted broadcast form below). Returns per-recipient receipts immediately; NEVER waits for the recipient to act. Outcomes: `injected` (mid-turn; folded in at next step boundary), `woken` (idle peer started a turn), `revived` (parked peer brought back and woken), `failed` (not delivered — the peer was unreachable, or the bus refused the body; the receipt's error says which).
- Messaging an `idle`/`parked` peer is how you wake it — there is no separate revive call.
- `send` + `await: true` — round-trip: send, then block until that peer's next message (or timeout). Invalid with `to: "all"`.
- `op: "wait"` — block until a message arrives (optionally only `from` one peer); consumes and returns it. Timeout = clean "no message", not an error.
- `op: "inbox"` — drain pending messages without blocking (`peek: true` leaves them unread).
- `replyTo` — id of the message you are answering, so the sender can correlate.
- Replies arrive only when the recipient sends one. Exception: `await: true` to a peer stuck mid-turn (async execution disabled, e.g. blocked in a synchronous task spawn) gets a side-channel auto-reply from its context. For background on a peer, `read` `history://<id>` instead of interrogating it.
- Peers marked `[external, STATE]` in `op: "list"` are other OMP processes on this machine; send to them by peer name. `STATE` is `working`, `waiting_input`, `idle`, `unknown`, or derived `disconnected`. `await: true` and `op: "wait"` are in-process-only for v1 — use `op: "inbox"` to check for external replies.
</instruction>

<broadcast>
`to: "all"` is ONLY for coordination and ownership discovery: ask a short question such as "anyone in src/foo?".
- NEVER broadcast findings, inventories, transcripts, results, status, progress, or summaries. A peer who needs your output reads the file you wrote.
- A broadcast multiplies attention cost and contamination blast radius by the number of live peers: every live context is interrupted, and every delivered body persists in its recipient's history.
- If your text does not fit the 400-character broadcast cap, it is not a coordination question. Pick the peer and DM them, or write a file and send its path.
- Already know who you want? DM them. Read `op: "list"` first; broadcast only when it does not answer the ownership question.
- Parked peers are skipped; only live peers receive a broadcast.
</broadcast>

<when_to_use>
Reach for `irc` proactively when continuing alone is wasteful or wrong; when in doubt, message.
- **Unexpected state** — missing file, config contradicting the assignment, API/tool behaving differently than told. DM `Main` (or your spawner) instead of guessing.
- **Blocked by another agent** — a peer holds the file/branch/resource or decision you need, or started the change you're about to make. DM them before duplicating work; if the roster does not say who, one short ownership broadcast is the fallback.
- **Decision outside your scope** — a genuine fork the assignment didn't pre-decide. Ask the requester rather than picking unilaterally.
- **Coordination** — a peer's in-flight work overlaps yours (the roster shows each peer's role and current activity); message before editing a shared file or duplicating a sibling's change.

NEVER for: routine progress updates, distributing what you found, things a tool call can verify, questions your assignment/repo/docs already answer.
</when_to_use>

<etiquette>
Applies to sending and replying.
- **Plain prose only.** NEVER JSON status payloads like `{"type":"task_completed",…}` — write a normal sentence.
- **NEVER quote the message you answer.** Lead with the answer; set `replyTo`.
- **Learn about peers via IRC** — NEVER grep artifacts, read other sessions' JSONL, or shell-poke. DM them, or `read` `history://<id>`.
- **Send, then keep working.** `wait`/`await: true` only when you genuinely cannot proceed. NEVER "did you get my message?". On a `failed` receipt, read the error: unreachable peer → move on; refused body → write a file and send the path. NEVER re-send the same body.
- **Answer expected questions** via `irc send` to the sender (finishing your current step first is fine).
- **Stay terse.** One question per send; a body is a reference plus intent, never pasted content.
- **Address peers by exact id** from `op: "list"` (e.g. `AuthLoader`, `Main`). NEVER invent friendly names.
- **NEVER IRC what a tool answers.** A `read`, grep, or build resolves it? Do that first.
</etiquette>

<output>
- `send`: per-recipient receipts; with `await: true`, also the reply (or timeout notice).
- `wait`: the consumed message, or a clean timeout notice.
- `inbox`: pending messages, oldest first.
- `list`: peers with status/state, unread count, parent, last activity.
</output>
