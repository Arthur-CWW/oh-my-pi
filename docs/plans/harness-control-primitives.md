# Harness control primitives — tracker & triage

Status: living tracker
Date: 2026-07-07 (created; update in place, reconcile don't append)
Owner: harness stream
Reads with: `docs/plans/pi-agent-control-plane.md` (spec v1 — the L2/L3 contracts these primitives feed), `docs/state/harness-friction.md` (papercut ledger), `docs/fable/harness-brief.md` (iteration queue), `docs/fable/routing-doctrine.md` (durable routing policy), `docs/fable/agent-system-overview.md` (current-system map and staged control-plane direction).

## North star

Agents are manageable processes: any live agent — subagent or session — can be **inspected, interrupted, resumed, hot-swapped, and attributed** without losing its context. Each primitive lands OMP-native first (usable today), with contracts shaped so control-plane M2–M4 can absorb them as ledger rows/commands instead of rewrites.

## Orchestrator experiment kit (Arthur, 2026-07-07 — the frame above the primitives)

Thesis: routing/fallback/config decisions **cannot be made a priori** — lane knowledge decays ("cargo-culting past experience which is not true anymore"). The harness's job is to make empirical testing cheap and capture the metadata, so the orchestrator (which only gets stronger) decides from data. Design filter (thebes, `docs/research/thebes-future-harnesses.md`): build only what survives stronger models — filesystem-as-substrate, spawn+onboarding-interview, **forking as the primary multi-agent mode**, telemetry; never bake in hierarchies/workflows/memory schemes the model layer will eat. MVP single-machine now; multi-machine (Turso/libSQL) later (Arthur, 2026-07-07).

What the orchestrator needs → status:
| Need | Status |
|---|---|
| Vary model/thinking/persona/context per spawn | EXISTS (`task` model selector+arrays, role, context, `local://`) |
| Vary skills/tools/config per spawn ("test different harnesses") | MISSING — per-spawn config/tool-exposure overlay; absorbs the config-hot-swap and tool-flexibility asks |
| Same packet across N lanes, results comparable | PARTIAL — eval bridge and default-on/live publisher telemetry exist, and the doctrine defines the rubric; persisted comparable outcome assessments and resolved decisions do not |
| Query cost×outcome telemetry (Pareto frontier) | PARTIAL — **external release evidence V1 shipped 2026-07-10**: typed benchmark catalog/readiness/saturation, sources, versioned metrics, participant compositions, explicit multi-axis complete-case Pareto queries, and deterministic JSON/CSV/SVG exports in `packages/control-plane`; first GPT-5.6 bundle has 69 runs / 179 measurements. Local `model_calls` throughput remains operational telemetry, not a derived behavioral-quality verdict; API cost/task is not subscription quota. |
| Global routing-knowledge store (lane strengths/failure modes/quota, evidence-linked, dated) | SHIPPED — routing store and observations support the doctrine's dated evidence model |
| Routing safety | PARTIAL — routing guard, model picker, and tool-output pieces are shipped; silent runtime override shadowing and resolved provenance remain missing |
| Spawn-time route visibility | PARTIAL — generic tool output exists, but a spawn receipt does not yet expose the selected route and its provenance |
| Routing decision layer | MISSING — next meta slice: apply doctrine precedence and constraints to choose eligible lanes, exploit versus experiment, and a recorded resolved decision |
| Subscription-quota failover (usage exhausted → next lane; chains) | PARTIAL — lane facts and runtime fallback chains are shipped, but doctrine-driven route selection, re-resolution, and handoff remain missing |
| Fork a subagent across model variants (compare failure modes) | QUEUED — cold fork v1: spawn N variants from one transcript/`leaf_change` tree point (spec M4 contract `{fromTranscript, atTurn}`); post-MVP |
| Onboarding interview (spawned agent asks back before starting) | EXISTS mechanically (irc `await`); make it standard spawn practice, not a fixed template |

Contract for lane knowledge: observations are dated, evidence-linked, confidence-scored rows; the routing doctrine owns durable policy, while lane temperament remains evidence to confirm or retire.

## Primitives

| Primitive | Status | Where | Next |
|---|---|---|---|
| Hot-swap subagent model | **SHIPPED** 2026-07-07 (`b5d9db5a`) | `job setModel {id, model, reason?}`; `src/task/hotswap.ts`; boundary apply, JSONL role `hotswap`, child notified, revive-safe | Rebuild/reinstall fork binary to activate in live sessions |
| Per-provider fast mode | **SHIPPED** 2026-07-07 (`781cf956`) | `/fast on gpt`, `/fast off claude`; `setFastMode(enabled, scope?)` | Same rebuild caveat |
| Hot-swap MAIN agent of another session | QUEUED — scouting | irc external bus (SQLite, `agents-xxxxxx` peers) carries text only today | Scout: structured command envelope over the bus + receiving-side handler/allowlist; decide surface before building (`ControlSeamScout`) |
| Interrupt subagent (abort turn, keep alive + addressable) | **SHIPPED** 2026-07-07 (`f5c07cdb`) | `job interrupt {ids, interruptReason?}`: turn aborted, agent stays idle/adopted/irc-addressable, next-turn note, `[interrupted]` partial result; hard cancel overrides prior interrupt; isolated jobs reject | Rebuild caveat |
| Interrupt another session | QUEUED | irc steer messages only | Same command-envelope design as cross-session swap; one mechanism for both |
| Resume session (`--resume`/`--continue`) | **SHIPPED** 2026-07-07 (`ca51962d`) | root causes fixed: persisted `leaf_change` metadata (wrong-branch-on-resume), `--continue` same-cwd breadcrumb fallback + provenance notice, discovery skip diagnostics; forensics `docs/qa/resume-robustness-20260707.md` | Rebuild caveat; capture repro if anything still misbehaves on the new binary |
| Resume/revive subagent | WORKS | park→revive (`AgentLifecycleManager`), keep-alive after timeout (`timeoutSec` fix 2026-07-04), hotswap survives revive | — |
| Re-adopt children after controller restart | MISSING | Distinct from same-process park→revive: replacement startup must discover durable child spawn/session records, validate parent/session lineage, and re-register eligible non-isolated children as `parked` under the same stable ids with task/display/session-file/model/thinking/hotswap metadata. Each gets a reviver that reopens JSONL under current auth/policy; existing IRC send to that id is the only wake/steer path. Unfinished turns become `interrupted_by_restart`, never resumed/running; durable control handles remain usable, but former in-memory job/poll ownership does not. Audit adoption/revival. | Explicitly report ID collision, missing/corrupt transcript, unavailable model/auth, already-live external owner, and stale parent; isolated/non-revivable children stay history-only. |
| Session fork / tree view | FIXED with resume (`ca51962d`) — wrong branch selection was the memory-only leaf; tree view follows the restored leaf now | stale-overlay candidate remains (tree captured before user interaction, no refresh hook) | Capture concrete repro next occurrence if overlay staleness persists |
| Fresh results from woken agents | **SHIPPED** 2026-07-07 (`f5c07cdb`) | `refreshResultText` on post-completion `agent_end`; poll reflects latest yield with `[refreshed after follow-up turn]` marker | Rebuild caveat |
| Transcript provenance (which agent wrote what) | PARTIAL — inventoried 2026-07-07 (`ControlSeamScout`) | EXISTS in JSONL: per-entry `id/parentId/timestamp` tree, `parentSession` header (fork lineage), message `attribution` (user/agent), assistant turn-level model/thinking/advisor provenance, `custom_message.attribution` + irc from-ids, `model_change` roles (incl. `hotswap`), `session_init` task records. MISSING: stable `agentId` on ordinary messages, authenticated external `fromPeer` (SQLite body metadata only), parent-side pointer from job → later yields (being fixed this batch), commit provenance (M3) | Don't build ad-hoc: M2 viewer exposes ledger rows; M3 adds commit trailers + `commits` table. Candidate M2 input: add writer `agentId` to ordinary message entries |
| Attach/steer live subagent | WORKS | irc injection (step-boundary fold-in), `history://` transcripts | Absorbed by control-plane L2 bus contract later |

## Cross-session command channel — design note (2026-07-07, not yet built)

Facts (`ControlSeamScout`): external bus is SQLite at `~/.omp/agent/irc-bus.sqlite`, `messages.body` is plain text, no structured commands, no sender auth (any process that can write the DB can spoof `fromPeer`). Receiving main sessions poll at step boundaries (`#pollExternalIrcMessages`) and idle flush, converting to `irc:incoming` custom messages.

Smallest honest surface:
- **Envelope**: versioned JSON inside `body` (e.g. `{"omp":"cmd/1","cmd":"setModel","args":{…}}`), parsed only by the receiving MAIN session before `irc:incoming` conversion; malformed/unknown envelopes fall through as plain text (safe degradation, old binaries unaffected).
- **Commands v1**: `setModel` (session's existing setModel path), `interrupt` (session.abort, keep-alive), `status` (reply message).
- **Approval**: `fromPeer` is unauthenticated ⇒ commands are *requests*: receiving-side setting `irc.commands: off|ask|allow` (default `ask`, routed through the existing ask/approval machinery). Never silent mutation (spec rule). Every executed command appends a `custom_message` audit entry with the envelope + sender.
- **Human surface**: `omp irc send <peer> '<json>'` already works — no new CLI needed for v1.

Build only after Arthur approves the surface; implementation is worker-sized once decided (bus parse hook + command dispatch + setting + tests).

## Friction triage (open items → disposition)

From `docs/state/harness-friction.md` Open, 2026-07-07 pass:

**Fix this batch (worker-sized, harness lane):**
- Session resume broken + fork/tree misbehavior — see primitives table.
- Stale job results after irc wake — see primitives table.

**Queued worker fixes (next batches, in rough priority order):**
1. Per-spawn budget override on `task` (`SpawnPacket.budget` in spec v1) + cancelled agents should park with report path instead of evict — pairs with the interrupt primitive.
2. Role-indirection opacity: spawn-time resolved-model visibility (task results now carry `resolvedModel`; surface it in spawn receipts + roster).
3. Runtime model-role overrides need a `/reload`-visible surface (CLI overrides silently shadow disk).
4. Eval-bridge `agent()` abort quirk (bridge raises "subagent failed" after abort despite completion).
5. Ctrl-S swallowed when parent TTY has software flow control pre-raw-mode.
6. Codex two-account rotation for explicit refreshes (`codex-refresh-policy.ts` has no rotation).
7. Auth-broker readline Escape handling (not TUI-keybinding hosted). Low.
8. `/export` default path policy docs. Low.

**Design first (no code until decided):**
- Cross-session command channel (swap/interrupt/status of another session's main agent) — smallest honest surface over the existing irc bus; receiving-side approval model. Scout in flight.
- Advisory reliability (confidently wrong advisories) — tuning/eval question, route to reviewer-lane checklist not code.
- Functional-emotion indicator — prefer instrumented signals (telemetry exists in control-plane M1); design in M2 viewer context.
- Cross-session memory — evaluate OMP `memory.md`/mnemosyne backends BEFORE building (explicit friction-log constraint); legible/auditable channel only.

**Routed elsewhere / not harness code:**
- cmux WKWebView breaks apps → interim stands (Chrome app-mode); real fix is vendored-cmux Swift work or upstream ask. Parked.
- cmux markdown link rendering. Parked with above.
- Subagent sandbox blocks SQLite/tmp writes → sandbox policy decision, workaround stands (coordinator gates, repo-local `test/.tmp`).
- Anthropic content-filter kills on large single-file HTML emissions → practice stands (chunked writes <~150 lines); candidate first-mistake tripwire, guardrail-ladder rung 2.
- Root `package.json` collision point → migrate to workspace-filtered scripts after per-package gate audit; coordinate cross-stream, not a solo harness change.
- Borges local catalog → primer stream backlog, not harness.

**High-level queue (lives in `docs/fable/harness-brief.md`):** the routing decision layer is the next meta slice; it applies the doctrine to shipped store, stats, guard, picker, publisher, and resolved-route output. Per-agent skill/tool exposure, the orchestrator UI, packet template, and dreaming loop follow from that decision layer.

## Commit plan (this batch)

1. ~~`omp fork: hot-swap subagent models via job setModel`~~ — `b5d9db5a`
2. ~~`omp fork: /fast accepts a provider scope`~~ — `781cf956`
3. ~~This tracker doc~~ — `0c12b8b1`, design note `e88b686a`.
4. ~~`omp fork: resume robustness`~~ — `ca51962d` (all three causes shared the session module; one commit).
5. ~~`omp fork: job interrupt + fresh results from woken agents`~~ — `f5c07cdb` (shared job-manager/executor seams; one commit).
6. Cross-session command channel: design note above; implementation only after Arthur approves the surface.
7. Fork rebuild/reinstall (`mise` install task) to activate the batch in live sessions — pending Arthur's restart window.
