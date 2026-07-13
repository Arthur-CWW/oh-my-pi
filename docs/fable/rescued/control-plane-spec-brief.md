> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-04T06-00-08-576Z_019f2bb6-8080-7000-8a22-156408ea1a65/local/control-plane-spec-brief.md

# Control-plane spec v1 — coordinator brief

Input for revising `docs/plans/pi-agent-control-plane.md` from "living draft v0" to "spec v1". Every decision below is settled with Arthur (2026-07-04 session) unless marked OPEN. Preserve v0 content that still holds (why-this-exists, work-routing quadrant, design principles, collab reuse boundary); restructure around the layer model; delete/rewrite what the decisions below supersede (e.g. "Elixir preferred for next slice").

## Layer model (the spec's spine)

```
L4  views/operators   k9s-style TUI, HTML viewers (React/Solid), 2D-grid experiments, LLM "operator" sessions
L3  control plane     work items, packets, routing, supervision — clients of L2
L2  substrate         event ledger + telemetry, message bus, artifact/context store, spawn/fork contracts.
                      Durable, HARNESS-AGNOSTIC. Ships as library + CLI (--json), importable from TS and Python.
L1  session harness   OMP (daily driver), Pi, Codex — publishers/clients of L2, never authorities
L0  models/providers  kv-cache, warm forking (provider-gated)
```

Vocabulary: sessions (harness processes) → agents (contexts within) → the plane (daemon+ledger) → operators (LLM clients that manage) → views (dumb clients). Ledger rows are primary (session/turn/event/artifact); "agent" is a view over rows, but stable ids/personas are kept as handles.

## Settled decisions

1. **Runtime: Bun + Effect v4.** Effect Schema at every boundary, TaggedErrorClass errors, Effect CLI. Elixir/OTP parked behind the JSON/SQLite contract (revisit only if supervision/distribution needs prove out). No OMP rewrite — the plane is new code beside the harness.
2. **Storage: SQLite, one machine.** libSQL/Turso named as the multi-machine escape hatch; per-machine daemon + HTTP federation over Tailscale preferred over replicated writes when a second machine joins. Honest scaling note required in spec: SQLite is the local cache/index tier; archive tier is files (Lopopolo pattern: end-of-week session archive upload + GC post-processing — cite as lifecycle inspiration). Reference Dan Luu's "filesystem error handling fails more than you expect" as the reason durable state goes through SQLite, not ad-hoc JSON files.
3. **Typed DB access:** Arthur likes Drizzle; evaluate `@effect/sql` vs Drizzle-with-Effect-wrapper — pick ONE, criterion: weaker models (Kimi) must be able to write correct queries against it. OPEN — spec lists both with a recommendation and the criterion, decision at first implementation slice.
4. **Harness-agnostic by construction.** OMP stays daily driver; runner adapters for `pi --mode rpc` and `codex app-server` are first-class. The harness choice must stop mattering.
5. **Not stiff.** New primitives/concepts must be addable as experiments without schema migrations breaking clients: event payloads are versioned open unions; unknown event kinds are preserved, not dropped.
6. **No OpenTelemetry.** Arthur explicitly rejects OTel ("both too much and too little"). Telemetry is custom, Effect-native instrumentation emitting our own event schema.

## Telemetry (highest-leverage first: model calls)

Primary table: model_calls — {ts, machine, session, agent, model, provider, effort/thinkingLevel, promptHash, systemPromptHash, skillProfile, packetId, tokens in/out/cacheRead/cacheWrite, cost, latencyMs, outcome: ok|error|refusal|contentFilter|abort, errorClass, retryOf, fallbackFrom}. Second: search/provider calls (Kagi etc.). Third: generic events (spawn, turn, toolCall, error, yield, hotswap, fork).
Purpose: (a) find unknown errors — Anthropic reliability, refusals, background breakage that today cascades invisibly; (b) drive fallback-model policy with data; (c) feed evals — fork a context, run variants, compare rows; (d) global-view lessons (e.g. "GPT-5.5 consistently bad at UI design; shadcn steers to usable baseline") get discovered by aggregation and encoded into routing tables — the dreaming-loop substrate.

## Provenance (new section — source control)

Requirement: tie commits ↔ agent sessions ↔ context used. Mechanism (off-the-shelf-first, per Arthur): git commit trailers (`Agent-Session: <sessionId>`, `Agent: <agentId>`, `Packet: <packetId>`) written by the harness at commit time; ledger table commits{sha, sessionId, agentId, packetId, ts} for the reverse index. Do NOT store transcripts in git. Jujutsu (xjdr's setup) noted as compatible-future, not adopted. Session archive lifecycle: active (SQLite+JSONL) → weekly archive (compressed, off-disk optional) → GC with distillation hooks (feeds the memory system, separate friction item).

## Contracts

- **Spawn contract** (packet): {id, role, assignment, ownerPaths, excludedPaths, lane/model, acceptance, nonGoals, timeoutSec, budget}. Onboarding interview is a first-class step: worker may interrogate spawner over the message bus before starting; the interview transcript is an artifact.
- **Fork contract**: spawn variant {fork: {fromTranscript, atTurn}} — implemented cold (child ingests transcript artifact) now; provider warm-fork (shared kv-cache) slots in at L0 later without L3 changes. Workspace forking via APFS clonefile (`cp -c`) for cheap CoW copies of working trees (also mitigates disk pressure). Forking ties into evals: fork → run variants → compare telemetry rows.
- **Hot-swap contract**: pause agent at a completion boundary, swap code/tools/prompt, resume with an explicit `hotswap` event injected into context (agent KNOWS it was swapped: what changed, when). KV-cache invalidation accepted — rare operation. Spec should note what OMP has today (/reload, extension reload) and what is missing (pause-at-boundary + swap metadata).
- **Steer channel**: any operator/human can attach to a running session (server or TUI mode) and message it — including "tell the orchestrator why it might be steering incorrectly". This is the existing irc bus surfaced through L2; the CLI hang fix + peer registration (2026-07-04) are prerequisites, done in the fork.

## Monitoring/durability requirements (Arthur's words, keep intent)

- High-level board: which agents exist, what they're doing, their contracts, artifacts produced — checkable "really quickly".
- Low-level drill: logs, subagent transcripts, review for persistent mistakes.
- Attach-and-steer from both server and TUI modes.
- **Legibility requirement**: the exact prompt sent, the actual code/processes — never hidden by TUI abstraction. A "show me the raw request" affordance at every model call.
- Review surfaces beyond TUI: after-the-fact review happens in custom HTML viewers (React or SolidJS, custom components per artifact type) — "just a different frontend to the same layers". TUI stays glanceable-only.

## Guardrails (weak-model support)

Lint-on-write hooks in the loop: when a weak lane writes code, ast-grep/eslint rules run immediately (no any/unknown, schema-at-boundary, banned patterns) and inject one corrective line. Guardrails are data (rule files), formalized progressively — "we don't need to get this all correct in first go". Strong models get freedom + powerful primitives; scaffolding inversely proportional to model strength (existing charter principle — cite it).

## Error handling

Today's failure mode: background breakage cascades ("something breaks in the background and it breaks everything"), errors from providers (Anthropic reliability, refusals) are invisible and unclassified. Requirements: typed error taxonomy (TaggedErrorClass), every background task supervised with a failure event row (never silent), fallback-model policy driven by telemetry, crash-safe by construction (a dead session leaves valid rows, no persistent corruption).

## Code-first primitives

The single most important harness property: models USE and COMPOSE primitives in code (TS or Python), not just tool calls — loops, forks, pipelines, custom tools written on the fly. L2 ships as a library with the same surface as the CLI. OMP eval kernel cited as the pattern proof.

## Milestones (vertical slices, each independently shippable)

- M1: event ledger + model-call telemetry (schema + Effect instrumentation lib + OMP publisher extension writing rows).
- M2: status/query API (--json CLI + HTTP/SSE) + first HTML log/session viewer (the review surface).
- M3: provenance — commit trailers + commits table + session archive/GC lifecycle.
- M4: fork + hot-swap experiments (cold fork via transcript artifacts, APFS clonefile workspaces, pause-swap-resume in the OMP fork).
Each milestone names its acceptance proof (what Arthur can click/run).

## Non-goals

OTel; distributed consensus; multi-machine replication (federation later); Elixir now; rewriting OMP/Pi; storing transcripts in git; steganographic/opaque memory encodings (legibility is a hard constraint).

## Open questions (keep a section, do not resolve silently)

- Drizzle vs @effect/sql (criterion above).
- Where the plane daemon lives: packages/control-plane (new) vs extending packages/web-access cockpit code. Coordinator leans NEW package with cockpit as donor code — state as recommendation.
- Turso/libSQL trigger condition (second machine? first remote worker?).
- How much of the thebes "onboarding interview" to formalize vs leave emergent.

## Context-budget experiments (added per Arthur 2026-07-04)

The central tuning problem: too little context starves the model, too much confuses it, and finding the balance today is tedious manual tweaking. The fork+telemetry loop exists precisely to make this cheap: fork one packet into variants that differ ONLY in context composition (skills loaded, system-prompt weight, doc excerpts, transcript depth), run, compare telemetry rows. Spec must name "context composition" as a first-class experiment axis alongside model and prompt — every spawn row records what context the agent was given (skillProfile, promptHash, contextManifest).

## Session-mutation events + hypothesis queries (added per Arthur 2026-07-04, second pass)

REQUIRED event kinds (durable, per session AND per branch of the session tree): modelSwap {from, to, branchId} — swapping models mid-session or between tree branches MUST mark the durable store; compaction {beforeTokens, afterTokens, strategy}; branch/fork {parentBranch, atTurn}; hotswap (already specced); resume.

Per-turn telemetry row: {contextTokens at turn start, toolCalls, editBytes, turnDurationMs, yieldKind} — these are the proxies that make "laziness/fatigue" queryable.

Affect channel: a per-turn slot for model self-report (glyph/short note) PLUS instrumented signals (retry streaks, error rates, advisory disagreement) — see the functional-emotion indicator item in docs/state/harness-friction.md; both channels logged so drift between self-report and instrumented state is itself visible.

**Schema acceptance = target queries.** The spec MUST include a "hypotheses this schema can answer" section with at least: (1) does Fable/Claude output quality/productivity degrade past N context tokens ("tired/lazy") — needs per-turn contextTokens × productivity proxies; (2) is compaction destructive for GPT-5.5 — compare turn outcomes before/after compaction events; (3) model × work-type affect patterns — affect channel × packet lane. Storage note: SQLite confirmed fine, swappable later, explicitly "not that important" — the schema contract is what matters.
