# Pi agent control plane / cockpit spec

Status: spec v1
Date: 2026-07-04
Owner: Arthur + Pi/OMP/Codex harness adapters
Scope: local, harness-agnostic agent control plane for supervising sessions, packets, telemetry, provenance, review, fork, and steer workflows.
Changelog: v1 replaces v0's runtime spike/Symphony framing with the L0-L4 substrate/control-plane spec, first-class telemetry, provenance, contracts, guardrails, and M1-M4 slices.

## Why this exists

The current pain is not tmux colors or status-line formatting. The real problem is human attention cost when supervising many concurrent agent sessions.

Symptoms:

- too many generic terminal tabs with redundant names
- poor discoverability of which session is doing what
- high context-switching cost when monitoring many agents
- no central live registry of active Pi/OMP/Codex-like sessions
- no trustworthy human review surface for each agent run
- background failures and provider refusals cascade invisibly
- context-budget tuning is manual and hard to compare

This project turns a pile of tabs and session logs into a small local agent control plane.

## Problem statement

Arthur wants to manage a group of long-running agent sessions in a way that is:

- fast like terminal workflows
- legible like a GUI
- scriptable like tmux and CLIs
- extensible like harness extensions
- structured enough to support orchestrator and reviewer agents

The system must support:

- fast switching between many sessions
- grouping sessions into workgroups and packets
- seeing current state at a glance
- opening a deeper human review view for one session or packet
- supervising orchestrated multi-agent work, not just raw tabs
- collecting telemetry that can answer whether a model, prompt, or context mix is working

## Key design insight

The horizontal terminal status line is a summary surface, not the control plane.

```txt
status line       = tiny, stable, glanceable
TUI board         = searchable, grouped, navigable, previewable
HTML review       = deep log/session/artifact viewer
orchestrator      = natural-language client over the same runtime state
SQLite/event log  = source of durable truth
```

The orchestrator chat/session is not the source of truth. It is a client of the plane.

## Vocabulary and layer model

Vocabulary:

- **session**: a harness process or run, such as OMP, Pi, Codex, or a shell-backed worker.
- **agent**: a context/persona inside a session. Stable ids and personas are handles, not the durable truth by themselves.
- **plane**: daemon plus ledger substrate that owns durable rows and contracts.
- **operator**: human or LLM client that manages work through the plane.
- **view**: dumb client over the plane, such as TUI, HTML viewer, CLI, or HTTP/SSE consumer.
- **packet**: a work contract: assignment, ownership paths, lane/model, acceptance, non-goals, budget.
- **branch**: a node in a session tree, created by fork, resume, model swap, or context variant.

Ledger rows are primary: session, branch, turn, event, artifact, packet, model call, commit. "Agent" and "workgroup" are views over those rows.

| Layer | Name | Responsibilities | Authority rule |
|---|---|---|---|
| L4 | views/operators | k9s-style TUI, HTML viewers, 2D-grid experiments, LLM operator sessions | Read/write only through L2/L3 APIs. No private truth. |
| L3 | control plane | work items, packets, routing, supervision, fallback policy, spawn/fork/hot-swap orchestration | Clients of L2. Owns policy decisions, not raw persistence. |
| L2 | substrate | event ledger, telemetry, message bus, artifact/context store, provenance index | Durable, harness-agnostic, library + CLI with `--json`, importable from TypeScript and Python. |
| L1 | session harness | OMP daily driver, Pi, Codex, shell/PTY runners | Publishers/clients of L2, never authorities. |
| L0 | models/providers | model APIs, kv-cache, provider-gated warm forking | Capabilities exposed upward; no control-plane state. |

## Settled decisions (2026-07-04)

| Decision | Spec |
|---|---|
| Runtime | Bun + Effect v4. Effect Schema at every boundary, TaggedErrorClass errors, Effect CLI. No OMP rewrite; the plane is new code beside the harnesses. |
| Storage | SQLite on one machine. SQLite is the local durable cache/index; archive tier is files. libSQL/Turso is the multi-machine escape hatch. Prefer per-machine daemon + HTTP federation over replicated writes when a second machine joins. |
| Typed DB access | OPEN: evaluate `@effect/sql` vs Drizzle-with-Effect-wrapper. Criterion: weaker models such as Kimi must be able to write correct queries against it. Recommendation for first slice: choose the boring option that yields clearer generated types and simpler examples, then document the rejected option. |
| Harness stance | Harness-agnostic by construction. OMP stays daily driver; `pi --mode rpc` and `codex app-server` adapters are first-class. Harness choice must stop mattering to L2/L3. |
| Event model | Not stiff. Event payloads are versioned open unions. Unknown event kinds and future payload versions are preserved, not dropped or coerced. |
| Telemetry | No OpenTelemetry. Use custom Effect-native instrumentation that emits this schema. |
| Elixir/OTP | Parked behind the JSON/SQLite contract; revisit only if supervision/distribution needs prove out. |

Storage rationale:

- Durable state goes through SQLite, not ad-hoc JSON files. Dan Luu's filesystem-error work is the warning: file APIs fail in more ways than most programs handle.
- JSONL/session files remain artifacts and append logs, but the queryable index and coordination state live in SQLite.
- Archive lifecycle follows the Lopopolo-style pattern: active local state, periodic compressed archive, then GC/distillation.

## Architecture by layer

### L0: models/providers

Provider capabilities are recorded, not assumed:

- provider and model ids
- effort/thinking level knobs
- token accounting and cache read/write accounting
- provider support for kv-cache and warm fork
- refusal/content-filter/error classes
- raw request and response artifact handles

Warm fork belongs here. L3 fork contracts must not change when a provider later supports shared kv-cache.

### L1: session harness adapters

First-class adapters:

| Adapter | Uses | Notes |
|---|---|---|
| OMP publisher | existing OMP session, tool lifecycle, IRC bus | Daily driver. Publishes rows and receives steer messages. |
| Pi RPC | `pi --mode rpc` or SDK/runtime mode | Programmatic launch/resume/fork path. |
| Pi publisher | existing interactive Pi session + extension | Good for observing normal terminal workflows. |
| Codex app-server | Codex JSON-RPC/app-server runner | Reference-compatible runner, not a privileged architecture. |
| tmux/zellij process | terminal attach/capture/send | Attachment and preview only; not semantic replay or durable truth. |
| direct PTY | controlled local process | Later option if replacing multiplexers is worth the scope. |

Harness facts preserved from v0:

- Pi has session files and session APIs, but no built-in cross-process live registry.
- Pi has UI hooks such as `ctx.ui.setTitle(...)`, `ctx.ui.setStatus(...)`, and `ctx.ui.setFooter(...)`.
- tmux and zellij provide attach, capture, pane/tab metadata, and survivable terminal sessions.
- Current terminal naming is too redundant and too tied to cwd/pane title.

L1 publishes normalized lifecycle events and artifacts. L1 does not decide packet state, review state, provenance, or fallback policy.

### L2: substrate

L2 ships as a library and CLI with the same surface:

- TypeScript import surface for OMP/Pi/web clients.
- Python import surface for evals, notebooks, and scripts.
- CLI commands emit bounded JSON with `--json`.
- HTTP/SSE can wrap the same library; no separate data model.

L2 owns:

- SQLite schema and migrations
- append-only event ledger
- model/search/provider telemetry
- message bus for attach/steer/interview
- artifact store and context manifests
- commit/session provenance index
- archive and GC lifecycle hooks

#### Durability and ingestion contract (settled 2026-07-04)

No queue is ever the only copy of an event. The write path is durable-source-first (outbox pattern), not fire-and-forget streaming:

1. **Publishers append to their own local append-only log first**, synchronously, before any hand-off (OMP's JSONL session journal already is this; other adapters mirror it). Each publisher owns its file — no cross-process contention.
2. **The daemon tails publisher logs into SQLite** and is the ledger's only writer. Daemon death loses nothing: restart, resume tailing.
3. **Ingestion is idempotent**: every event carries a stable id (`sessionId`, `seq`); ledger insert is `INSERT OR IGNORE` on that unique key. At-least-once tailing + idempotent writes = effectively exactly-once. Event ids are assigned at the publisher, never at ingest.
4. **Group commit**: the daemon batches (N events or T ms) into one transaction — fsync cost amortizes; hot loops grow the batch, never drop data. WAL + `synchronous=NORMAL`: process crash loses nothing; power loss may trim the last instants but never corrupts (publisher logs cover replay).
5. **No two-phase commit anywhere**: one store is authoritative per datum, everything else is a rebuildable view. Atomicity needs that span "state + event" (e.g. packet claim + its event) are one transaction in the one ledger DB.
6. **DST invariant**: after any seeded crash/kill/restart schedule, no publisher-log event is missing from the ledger and none is duplicated.

### L3: control plane

L3 owns policy and supervision:

- packet queue, routing, claim/update, owner path conflicts
- workgroups as views over packets/sessions/branches
- runner selection and model/lane assignment
- background task supervision and failure events
- fallback-model policy from telemetry
- fork/hot-swap/resume orchestration
- guardrails-in-loop for weak lanes

The control plane mutates L2 through typed commands. Every mutation writes an event row.

#### Coordination protocol (settled 2026-07-04)

Agents self-coordinate; synchronization is a cost, not a virtue (Amdahl / USL coherency term: interrupt cost serializes the recipient and grows with participants). Escalation ladder, cheapest first — use the lowest rung that suffices:

1. **Partition**: ownership zones via packet `ownerPaths`/`excludedPaths`; zero coordination inside a zone.
2. **Pull at boundaries**: shared state lives in the git log, the spec, and the ledger; agents read at their own natural boundaries (turn start, packet dispatch, review gate). Commit messages are global state — write them to be read.
3. **Optimistic**: proceed without asking; collisions surface at merge/review; the rare loser redoes.
4. **Interrupt** (DM/steer): ONLY to prevent imminent, expensive, irreversible waste that no upcoming boundary would catch in time. The interrupt budget is near zero; each one must justify itself.

Contract boundaries (zone A owns what zone B consumes wholesale) still synchronize — but by pull-at-boundary, never push-interrupt.

### L4: views/operators

L4 clients are replaceable:

- k9s-style TUI for glanceable status and quick drill
- HTML viewers for after-the-fact review of logs, sessions, model calls, artifacts, diffs, and provenance
- CLI for scripts and weak-model-safe interaction
- LLM operator sessions for planning, routing, and review
- future 2D-grid experiments over the same rows

HTML viewers are the primary deep-review surface. TUI is glance-only plus quick navigation.

## Data flow

```txt
L0 provider call
  -> L1 harness adapter records raw request/response artifact handles
  -> L2 writes model_calls + turn/event rows
  -> L3 updates packet/session/branch state if needed
  -> L4 views query or subscribe over CLI/HTTP/SSE
```

Rules:

- Never infer durable state from terminal scrollback.
- Never hide raw prompts, requests, tool commands, or process facts behind a UI abstraction.
- Unknown event kinds must round-trip through storage and JSON APIs.
- Retries and fallbacks keep chains: original error, `retryOf`, `fallbackFrom`, and final outcome.

## L2 ledger and schemas

Primary durable row families:

| Row family | Purpose | Notes |
|---|---|---|
| `sessions` | Harness process/run identity | Stable handles, machine, harness kind, workspace, current status. |
| `branches` | Session tree nodes | Created by fork, resume, model swap, or context variant. |
| `turns` | Per-turn execution record | Context size, tool/edit/time/yield proxies. |
| `events` | Append-only generic events | Versioned open union with preserved unknown payloads. |
| `model_calls` | Highest-leverage telemetry | Required fields below. |
| `provider_calls` | Search/Kagi/other provider calls | Same outcome/error discipline as model calls. |
| `artifacts` | Raw requests, transcripts, diffs, outputs, context manifests | Retention policy explicit per artifact. |
| `packets` | L3 work contracts | Spawn packet fields below plus state. |
| `commits` | Git provenance reverse index | Commit trailers point back to rows. |

Workgroup/session/review objects remain useful, but they are views over these rows, not separate sources of truth.

## Telemetry schema

`model_calls` is first because it answers the highest-leverage questions.

Required columns:

| Column | Meaning |
|---|---|
| `ts` | UTC timestamp. |
| `machine` | Machine id. |
| `session` | Session id. |
| `branchId` | Branch within the session tree. |
| `agent` | Agent/persona handle. |
| `model` | Model id. |
| `provider` | Provider id. |
| `effort` / `thinkingLevel` | Provider-specific reasoning knob, normalized where possible. |
| `promptHash` | User/developer prompt hash. |
| `systemPromptHash` | System prompt hash. |
| `skillProfile` | Loaded skills/rules/profile id. |
| `contextManifest` | Artifact id describing context composition. |
| `packetId` | Packet/work contract id. |
| `tokensIn` | Prompt/input tokens. |
| `tokensOut` | Output tokens. |
| `cacheRead` | Provider cache-read tokens/units. |
| `cacheWrite` | Provider cache-write tokens/units. |
| `cost` | Provider cost in normalized currency units. |
| `latencyMs` | End-to-end latency. |
| `outcome` | `ok`, `error`, `refusal`, `contentFilter`, or `abort`. |
| `errorClass` | Typed error class when outcome is not `ok`. |
| `retryOf` | Prior model_call id if this is a retry. |
| `fallbackFrom` | Prior model/model_call id if this is a fallback. |
| `rawRequestArtifact` | Exact request payload artifact. Required for legibility. |
| `rawResponseArtifact` | Exact response payload artifact or retention marker. |

Second priority: search/provider calls such as Kagi, browser/search APIs, vector search, and remote service calls. Required shape: timestamp, session, branch, packet, provider, operation, input hash, raw request artifact, latency, outcome, error class, cost/usage if known.

Third priority: generic events. Required event kinds:

- `spawn`
- `turn`
- `toolCall`
- `error`
- `yield`
- `hotswap`
- `fork`
- `resume`
- session-mutation events listed below

### Session-mutation event kinds

These events are durable per session and per branch of the session tree:

| Event kind | Required payload |
|---|---|
| `modelSwap` | `{from, to, branchId}`. Swapping models mid-session or between branches must mark the durable store. |
| `compaction` | `{beforeTokens, afterTokens, strategy}`. |
| `branch` / `fork` | `{parentBranch, atTurn}` plus child branch id. |
| `hotswap` | What changed, when, and which code/tools/prompt were swapped. |
| `resume` | Source branch/session, resume turn, and context artifact. |

### Per-turn telemetry

Every turn row records:

| Field | Meaning |
|---|---|
| `contextTokens` | Tokens at turn start. |
| `toolCalls` | Count and optional compact summary of tool calls. |
| `editBytes` | Bytes inserted/deleted/changed through edit/write operations when available. |
| `turnDurationMs` | Wall-clock turn duration. |
| `yieldKind` | `done`, `blocked`, `handoff`, `error`, `timeout`, or harness-specific open-union value. |
| `affectSelfReport` | Model self-report glyph or short note. |
| `affectSignals` | Instrumented signals: retry streaks, error rates, advisory disagreement, aborts, fallback pressure. |

Affect has two channels: self-report plus instrumented signals. Drift between them is visible and queryable.

### Telemetry purposes

Telemetry must support:

- finding unknown errors: provider reliability, refusals, content filters, background breakage
- fallback-model policy with data, not vibes
- eval variants: fork context, run variants, compare rows
- global routing lessons, such as model × work-type weaknesses and useful steering patterns
- dreaming-loop inputs after review, not automatic opaque memory writes

## Hypotheses this schema can answer

1. **Does Fable/Claude output quality or productivity degrade past N context tokens?**
   - Join `turns.contextTokens` with productivity proxies: `toolCalls`, `editBytes`, `turnDurationMs`, `yieldKind`, and review outcome.
2. **Is compaction destructive for GPT-5.5?**
   - Compare turn outcomes and review results before/after `compaction` events for the same packet/model/lane.
3. **What model × work-type affect patterns matter?**
   - Join affect self-report and instrumented signals with packet lane/work type, model, provider, and outcome.

Storage note: SQLite is fine and swappable later. The schema contract matters more than the first local DB adapter.

## Context-budget experiments

Context composition is a first-class experiment axis alongside model and prompt.

Every spawn row records:

- `skillProfile`
- `promptHash`
- `systemPromptHash`
- `contextManifest`
- transcript depth and selected excerpts
- loaded policy/rule files
- model/provider/lane

Fork comparisons should vary one declared axis where possible:

- skills loaded
- system-prompt weight
- doc excerpts
- transcript depth
- model/provider
- compaction strategy

Without a context manifest, comparisons are misleading and must not be treated as eval evidence.

## Provenance and archive lifecycle

Requirement: tie commits to agent sessions and context used.

Mechanism:

- Harness writes git commit trailers at commit time:
  - `Agent-Session: <sessionId>`
  - `Agent: <agentId>`
  - `Packet: <packetId>`
- L2 writes `commits{sha, sessionId, agentId, packetId, ts}` for reverse lookup.
- Do not store transcripts in git.
- Jujutsu is a compatible future, not adopted in v1.

Archive lifecycle:

1. **Active**: SQLite rows plus JSONL/session artifacts are local and queryable.
2. **Weekly archive**: compress session artifacts; optionally move off disk.
3. **GC dry run**: show rows/artifacts that would be removed and retained summaries.
4. **GC apply**: remove cold artifacts only after indexes and retained artifacts are valid.
5. **Distillation hooks**: produce reviewed inputs for memory/routing systems. This is separate from the runtime ledger and never opaque.

## L3 packets, routing, and supervision

The packet is the L3 work contract. It is not prose buried in a planning doc.

Spawn packet fields:

```ts
interface SpawnPacket {
  id: string
  role: string
  assignment: string
  ownerPaths: string[]
  excludedPaths: string[]
  lane: string
  model?: string
  acceptance: string[]
  nonGoals: string[]
  timeoutSec?: number
  budget?: {
    tokens?: number
    cost?: number
    wallClockSec?: number
    toolCalls?: number
  }
}
```

Packet rows keep high-churn coordination fields:

- packet id, title, workstream/lane, status, priority, short summary
- source pointer: Markdown path/heading, packet manifest, issue id, or external ledger row
- owner/excluded/dirty paths
- assigned worker/reviewer/session/branch ids
- proof links to QA notes, artifacts, session logs, data folders, and commits
- created/updated/claimed/review-ready/done/stale timestamps
- append-only status events

Agents query the ledger for eligible work, claim atomically, read owner/excluded paths, and write proof/status events. They do not infer packet availability from prose when the ledger exists.

### Onboarding interview

The spawn path includes a first-class interview step. A worker may interrogate the spawner over the message bus before starting. The interview transcript is an artifact and can be attached to the packet.

### Routing quadrant

A useful framing is to classify work by novelty and difficulty/ambiguity.

```txt
                         difficult / ambiguous
                                  ▲
                                  │
      live exploratory            │       autonomous but supervised
      human-in-loop               │       big/long-running
      tmux/zellij attach useful   │       control plane useful
                                  │
novel ◄───────────────────────────┼───────────────────────────► straightforward
                                  │
      short interactive           │       batch autonomous
      one-off Pi/OMP chat         │       queue/worktree/review packet
      maybe no control plane      │       control plane most useful
                                  │
                                  ▼
                            easy / routine
```

Implications:

- tmux/zellij live attach is mainly for novel + difficult/exploratory work.
- Autonomous supervised orchestration is mainly for straightforward or well-specified work that can run without live human supervision.
- The control plane is most valuable when many runs are happening at once.
- Exploratory sessions still benefit from titles, status, grouping, and steer, but may not need heavy orchestration.
- The system should route work to the right execution mode instead of treating every task as an interactive tab.

## Contracts: fork, hot-swap, steer

### Fork contract

Spawn variant:

```ts
{ fork: { fromTranscript: string, atTurn: number } }
```

Requirements:

- Cold fork now: child ingests transcript/context artifact and starts as a new branch.
- Warm fork later: provider kv-cache slot at L0; no L3 contract change.
- Workspace fork uses APFS clonefile (`cp -c`) for cheap copy-on-write working trees when available.
- If clonefile semantics are unavailable, M4 must fail explicitly or choose a declared fallback; it must not silently trust an expensive or lossy copy.
- Forks are eval primitives: fork, run variants, compare telemetry rows.

### Hot-swap contract

Requirements:

- Pause the agent at a completion boundary.
- Swap code, tools, prompt, or harness adapter.
- Resume with an explicit `hotswap` event injected into context.
- The agent must know it was swapped: what changed and when.
- KV-cache invalidation is acceptable because hot-swap is rare.
- OMP has `/reload` and extension reload today; missing pieces are pause-at-boundary plus durable swap metadata.

### Steer channel / collaboration boundary

The existing IRC/collab bus is surfaced through L2 as the attach/watch/steer channel.

Useful for:

- live attach to a running child agent
- watch progress without owning the session
- steer or interrupt within the runner's native capabilities
- tell an orchestrator why it might be steering incorrectly
- support server mode and TUI mode with the same message path

Explicitly not:

- source of truth for workflow state
- registry or database
- durable transcript store
- task queue
- learning store

Durable state lives in SQLite rows and artifacts. Store view links, evidence handles, and credential references in the ledger by default, not full collab write links.

## L4 monitoring and review surfaces

Requirements:

| Surface | Requirement |
|---|---|
| High-level board | Show which agents/sessions exist, what they are doing, contracts, lanes, statuses, blockers, and artifacts produced. Must be checkable quickly. |
| Low-level drill | Open logs, subagent transcripts, model calls, raw requests, tool calls, diffs, and persistent mistakes. |
| Attach-and-steer | Available from server and TUI modes through the L2 bus. |
| Legibility | Every model call has a "show raw request" affordance. Actual code/processes/tool calls are visible. |
| HTML viewers | Primary after-the-fact review surface, built with React/Solid/custom components per artifact type over the same API/ledger. |
| TUI | Glanceable, searchable, keyboard-first, quick drill only. Not the primary deep-review surface. |
| Status line | Tiny stable summary only; no noisy or jittery model-derived labels. |

Navigation concepts preserved from v0:

- Do not rely on tmux window numbers as the main navigation primitive.
- Search and hint chords beat numeric tabs.
- Titles prefer manual override, explicit session name, derived short task title, then workspace fallback.
- Update titles on task boundaries, not every tool call.
- Review views must state diff trust level: no isolated worktree means touched files/recent output only; isolated worktree means trustworthy session-specific diff.

## Guardrails in the loop

Weak lanes get immediate corrective scaffolding; strong lanes keep freedom and code-first primitives.

Requirements:

- Lint-on-write hooks run inside the loop for weak lanes.
- Rules can be ast-grep, eslint, schema-at-boundary checks, no-any/unknown checks, or banned-pattern checks.
- A failing hook injects one corrective line into the session context.
- Guardrails are data/rule files and can be formalized progressively.
- Do not turn these into broad repo-wide format/lint gates for every lane.
- Scaffolding is inversely proportional to model strength.

## Error handling requirements

Typed error taxonomy uses Effect `TaggedErrorClass` classes at boundaries.

Initial taxonomy:

| Error class | Examples | Required handling |
|---|---|---|
| `ProviderError` | 5xx, timeouts, malformed response | Model/provider call row with retry/fallback chain. |
| `ProviderRefusal` | refusal, safety stop | Outcome `refusal`; do not hide behind fallback success. |
| `ContentFilter` | provider filter or blocked output | Outcome `contentFilter`; keep raw metadata allowed by policy. |
| `HarnessError` | OMP/Pi/Codex adapter failure | Session event plus supervised task failure row. |
| `ToolError` | tool crash, invalid args, permission failure | Tool event and turn outcome linkage. |
| `StorageError` | SQLite write/migration/archive failure | Stop mutation path; leave prior rows valid. |
| `ArtifactError` | raw request/transcript/diff artifact missing or corrupt | Mark artifact invalid; do not pretend review is complete. |
| `BudgetExceeded` | token/cost/wall-clock/tool-call budget | Abort or steer according to packet policy. |
| `GuardrailViolation` | weak-lane lint/rule failure | Inject corrective line and record rule id. |
| `SupervisorError` | background task died | Failure event row; never silent. |

Crash-safety invariants:

- Every background task is supervised.
- Every background failure writes a failure event row.
- A dead session leaves valid rows and no persistent corruption.
- No silent state mutation by an orchestrator or view.
- Fallback policy is telemetry-driven and preserves original failures.

## Code-first primitives: library + CLI parity

The most important harness property: models use and compose primitives in code, not only through tool calls.

L2/L3 primitives must be callable from TypeScript, Python, and CLI:

- spawn packet
- claim/update packet
- publish event
- record model/provider call
- attach/steer
- fork context
- resume branch
- hot-swap at boundary
- query status
- open raw request/artifact
- compare telemetry variants

CLI parity rule: if a primitive exists in the library, a bounded `--json` command exists for it, and both use the same schema.

This enables loops, forks, pipelines, custom tools, and eval harnesses written on the fly. Tool calls alone are not enough.

## Testing strategy: scaled-down DST

Full survey: `docs/research/dst-scaled-down.md` (2026-07-04). JS run-to-completion semantics plus Effect's injectable services make the cheap 80% of Antithesis-style DST nearly free — IF the day-one rules hold. Retrofit is where DST costs explode; design-in is a lint rule.

Day-one rules (apply to all L2/L3 code from the first commit):

- No `Date.now` or raw timers — `Clock` service only. Tests drive time with `TestClock.adjust`.
- No `Math.random` — `Random` service only. `Random.withSeed(seed)` makes runs reproducible.
- All I/O behind `Context.Tag` services with a prod layer and a simulated layer (in-memory bus with seeded delay/drop/duplicate; in-memory SQLite behind a buggify wrapper injecting `SQLITE_BUSY` and crash-between-write-and-commit).
- Single-writer event-loop core (already the architecture).
- Every simulated run keyed by a printed `(seed, config)` — failures replay by seed.
- `always` invariants checked every step (e.g. ≤1 live claim per packet); `sometimes` coverage counters (e.g. contention actually occurred) asserted per batch.

Stack: Effect v4 `TestClock` + `Random.withSeed` + fast-check `fc.scheduler()` for interleaving exploration + a ~200-500 LOC owned simulation harness. Zero new runtime frameworks. Skip: hypervisors, multi-process sim, disk-sector faults, exhaustive model checking.

Decision rule: bug needs a timing diagram → DST; bug is an input value → plain property test; bug is a screenshot/config → e2e smoke.

## Existing donor code / current pilot

Current donor seams, not the v1 architecture:

- `packages/web-access/src/agent-cockpit.ts`: SQLite schema/store, session/workgroup/event records, terminal snapshot normalization.
- `packages/web-access/src/agent-cockpit-extension.ts`: Pi publisher/tool integration.
- `packages/web-access/src/agent-cockpit-cli.ts`: local CLI prototype.
- `packages/web-access/test/agent-cockpit.test.ts`: M1-style fixture proof donor.

Current pilot table names may inform migration, but v1 schema is the contract above. Terminal multiplexers remain optional L1/L4 attachment adapters, not the semantic substrate.

Symphony is an architecture reference for work items, workspace isolation, dashboard/API split, and supervised workers. It is not the v1 runtime or UX frame.

## Non-goals

- OpenTelemetry.
- Distributed consensus.
- Multi-machine replicated writes.
- Elixir now.
- Rewriting OMP or Pi.
- Storing transcripts in git.
- Steganographic or opaque memory encodings.
- TUI as the primary deep-review surface.
- Terminal multiplexer as semantic authority.
- Automatic dream-memory promotion without reviewed evidence.
- Building a full terminal multiplexer.

## Milestones and acceptance proofs

Each milestone must be independently shippable and prove itself with something Arthur can click or run.

| Milestone | Slice | Acceptance proof |
|---|---|---|
| M1 | Event ledger + model-call telemetry: schema, Effect instrumentation library, OMP publisher extension writing rows. | Run a local fixture or OMP publisher simulation that writes `sessions`, `turns`, `model_calls`, provider calls, artifacts, and generic events to SQLite. Run CLI `status --json` or `model-calls --json` showing model/provider/token/cost/latency/outcome/contextManifest and raw-request artifact linkage. |
| M2 | Status/query API plus first HTML log/session viewer. | Start daemon/API, run `status --json`, and open an HTML viewer that reads the same rows, shows high-level board, drills into one session, and opens a raw model request. SSE updates are visible during a fixture run. |
| M3 | Provenance: commit trailers, commits table, archive/GC lifecycle. | Make a commit through the harness path with `Agent-Session`, `Agent`, and `Packet` trailers. Query `commits` by sha/session/packet. Run archive/GC dry-run showing active -> weekly compressed archive -> retained distillation hooks, with no transcripts stored in git. |
| M4 | Fork + hot-swap experiments. | Cold-fork a packet from a transcript artifact into APFS clonefile workspace variants, vary context composition in `contextManifest`, compare telemetry rows, then pause/swap/resume an OMP-forked agent and show the `hotswap` event injected into its context/log. |

## Open questions

1. ~~Typed DB choice~~ SETTLED 2026-07-04: Drizzle over `bun:sqlite` in thin Effect services; `@effect/sql` rejected (rationale in `docs/plans/control-plane-m1.md`).
2. ~~Package location~~ SETTLED 2026-07-04: new `packages/control-plane`; cockpit code donor concepts only (`docs/plans/control-plane-m1.md`).
3. Turso/libSQL trigger: second machine, first remote worker, or another threshold?
4. Onboarding interview: how much of the thebes-style interview should be formalized vs left emergent?

## References

Local research notes:

- `docs/research/pi-agent-control-plane/openai-harness-engineering-notes.md`
- `docs/research/pi-agent-control-plane/openai-symphony-blog-notes.md`
- `docs/research/pi-agent-control-plane/openai-symphony-spec-notes.md`
- `docs/research/pi-agent-control-plane/codex-app-features-notes.md`
- `docs/research/pi-agent-control-plane/odysseus0z-orchestration-notes.md`
- `docs/research/pi-agent-control-plane/source-urls.txt`

Influences (where the ideas came from):

- thebes / `@voooooogel` — what survives stronger models: filesystem as the collaboration substrate, spawn + onboarding interview, forking as the primary multi-agent mode (cache-aware, cold now / warm later), transcripts-as-data. Also the Opus-3 cross-instance-reasoning thread: RLVR myopia is why the plane must make past instances queryable (legible memory, succession notes).
- andrew blinn / `@disconcision` — "multiple agents is a human conceptual affordance": ledger rows are primary; "agent" is a view over rows.
- xjdr / `@_xjdr` — jj-drafts + sapling-stacks SCM, review/merge as the bottleneck past ~10 sessions, push-to-wake over polling, "intelligence is in the harness". Archived: `docs/research/xjdr/`.
- Kubernetes / k9s — control plane vs clients; the TUI is a client of the plane, never the truth.
- Erlang/OTP — supervision trees, hot code swap, distribution; parked as substrate, adopted as requirements (supervised background tasks, hot-swap contract).
- TigerBeetle — DST plus its simulator viewer: a deterministic event log can be re-rendered as anything, including a game (the 2D-grid view idea).
- OpenCode — client/server + multi-attach + default tracing; comparison and piecemeal-adoption verdicts in `docs/research/opencode-vs-omp.md`.
- Replicache / Rocicorp Zero — change-sourcing (WAL/replication tailing) pattern for local-first sync; informs the watch-for-row-change question.
- Antithesis — full deterministic-simulation testing environment; the scaled-down DST ambition lives in `docs/state/side-quests.md`.
- Kleppmann, DDIA — log-centric design and derived data: everything but the ledger must be rebuildable from the ledger.
- OpenAI harness engineering — agents use composable code primitives, not only UI/tool wrappers.
- OpenAI Symphony — work items, isolated workspaces, supervised runners, dashboard/API separation.
- Codex app — projects, worktrees, review, parallel threads.
- Dan Luu, filesystem error handling — rationale for SQLite over ad-hoc durable JSON files.
- Lopopolo — archive/GC lifecycle: active state, periodic archive, post-processing/distillation.
- George / `@odysseus0z` — Linear/worker orchestration and overnight ticket throughput.
- Isaac Yonemoto / `@DNAutics` on Rivet Actors — "links and monitors make all the difference; the BEAM is not an actor system": the OTP-lite claim for Effect fibers is honest only because structured concurrency gives links (child failure propagates to parent scope) and `Fiber.await`/`onExit` give monitors (observe death without propagating); the real unclosed gap vs OTP is distribution/location transparency. Found report: `docs/research/otp-vs-effect-tweet.md`.
