# OMP Session Lifecycle Commands

> **Class:** Current design authority for visible session/orchestrator lifecycle commands.
> **Owner:** harness stream.
> **Status:** `/commission` and genealogy substrate partly implemented; Arthur chose `/successor` with `/succ` shorthand for the linear-successor command; no generic `/finish` command; `/fork`, `/tangent`, `/converge` remain requested until code + proof satisfy this contract.
> **Generator:** Arthur's 2026-07-19 design discussion plus 2026-07-22 placement/context/naming corrections (provenance A/A~).

## Core model

A **cmux workspace is the durable workstream container**, not a session. Visible OMP sessions for that stream are named tabs/surfaces in its canonical OMP pane. A lifecycle command never creates another workspace for the same workstream.

Journals are the uncompressed why/history. Handoffs and goals are the bounded startup context. Genealogy records explicit DAG edges; it does not imply copying the predecessor transcript into every successor.

| Command | Relationship | Startup context | Source behavior |
|---|---|---|---|
| `/successor` (`/succ`) | Linear successor | Fresh top-level OMP orchestrator seeded by a concise provenance-stamped live handoff and current stream goal/pointers | Source remains alive/addressable and reviewable by default; `--retire-source` closes its view only after successor health |
| `/fork` | Parallel branch of the same problem/workstream | Explicit source session + journal entry/turn; new session identity; branch context appropriate to the fork | Source remains intact; both count toward active-session cap |
| `/tangent` | New distinct concern/substream discovered from current work | Minimal brief plus source pointers and stated concern | Source remains intact; tangent owns its own scoped goal |
| `/converge` | Join selected related sessions | One synthesis/handoff artifact citing all sources; one fresh successor | Park sources only after successor health; source journals remain authoritative |
| `/commission` | Visible autonomous child while parent remains synchronous | Scoped durable handoff, explicit parent/session/turn provenance, child-only goal | Parent continues immediately; child is independently visible and pinned |
| `task` | Hidden/in-process worker | Typed task packet and parent context contract | Not a visible lifecycle/tab command |

The linear-successor operation is **not** `omp --fork`: it does not copy the predecessor transcript into the new context. The fresh orchestrator reads the bounded handoff, stream goal/current authorities, and retrieves predecessor history lazily only when needed. `/continue` is overloaded in OMP/model/tool vocabulary; keep `continued_from` as the genealogy relationship while `/successor` names the user action. `/relay` was rejected because it may later name IRC/message relaying.

## Shared transaction

Every visible lifecycle command:

1. resolve the current workstream and canonical cmux workspace/OMP pane;
2. enforce the per-workstream active-session cap before launch;
3. write or validate the required handoff/synthesis artifact;
4. record durable lineage: relationship kind, source session(s), source turn/journal pointers, workstream, command, artifact hash, and initiator;
5. resolve the successor's **top-level orchestrator model** through the live configurable `modelRoles.orchestrator` role; explicit `--model` is validated by the same resolver/capability policy. Never inherit a cheap worker/reviewer lane accidentally; orchestrator-only restrictions remain enforced;
6. create a fresh OMP process/session in a named tab/surface in the **existing** workspace/pane;
7. register a stable unique human-readable name plus metadata with fleet/IRC/genealogy, and set the intended goal only in the new session;
8. wait for a real health/readiness receipt before mutating source lifecycle;
9. write a persistent cmux inbox receipt naming exact workspace, pane, tab/surface, session/IRC name, relationship, source(s), goal/handoff, resolved model route, and status; make the receipt actionable/jumpable;
10. on failure, keep sources authoritative and remove partial surfaces/receipts.

No automatic focus theft. The command may create the tab and notify; Arthur chooses whether to jump. A user-requested focus flag may select it explicitly.

## Command semantics

### `/successor` (`/succ`) `[--name <name>] [--model <route>] [--retire-source] [--source-note <text>] [successor focus]`

Use when one orchestrator creates the same stream's linear successor because context is long, the model changes, the operator wants a fresh working set, or the predecessor is done. The noun-like command is precise; `/succ` is the ergonomic shorthand.

The handoff contains current objective/goal, settled decisions, active blockers, owned changes/workers, exact next action, review surfaces, optional source note, and predecessor `history://` pointer. It does not inline the full transcript. Rejected alternatives: `/continue` is overloaded; `/handoff` collides with existing artifact/session behavior; `/relay` may belong to IRC/message routing; `/rotate` misses responsibility transfer.
#### Name and identity

Derive a concise work-descriptive default from workstream + active objective (for example `HarnessSuccessor` or `ServerBootstrap`), then disambiguate deterministically. `--name` overrides the label but not uniqueness. The same stable name must address the session in IRC and appear in `history://`, fleet, cmux tab title, notifications, and receipts; do not expose an anonymous `agents-<random>` identity as the primary operator handle.

Record: session ID, stable name, workstream, objective/goal summary, predecessor session, `continued_from` edge, handoff path + content hash, resolved provider/model/effort and routing receipt, cmux workspace/pane/surface/tab, initiator, started time, and health/lifecycle state.

#### Orchestrator model

The successor is a top-level orchestrator, not a generic task worker. Resolve in order: explicit eligible `--model`; live `modelRoles.orchestrator`; `modelRoles.default` only as an explicit compatibility fallback; otherwise fail with actionable configured choices. Candidate families and provider availability change frequently, so the command must call the existing role/model resolver and persist its route receipt—never hardcode Fable/Kimi/Sol names or silently inherit the model of a child/reviewer session.

### `/fork <source-ref> [branch objective]`

Use for an alternative hypothesis or parallel continuation of the same problem. The source reference resolves to a stable session + message/turn/journal entry. The fork receives a branch objective and bounded evidence pointers. It keeps explicit `forked_from` lineage and does not replace or park its source.

### `/tangent <concern>`

Use when work reveals a distinct concern that deserves its own stream of attention rather than contaminating the source context. The tangent brief says why it was split, its scope/non-goals, source pointers, and first decision. Retire/reassign any legacy `/tan` meaning that merely launches hidden background work; `task` owns that behavior.

### `/converge <source...>`

Use when branches have produced enough evidence to synthesize. Convergence is not transcript concatenation. It produces one explicit synthesis artifact: agreements, contradictions, selected decisions, rejected alternatives, unresolved questions, artifacts/changes, and source pointers. One fresh successor starts from that artifact; sources park only after health.

### `/commission <name> <scoped objective>`

Use for visible asynchronous autonomous work while the parent remains synchronous. The child gets a scoped handoff, stable name/pin, explicit `commissioned_from` parent/session/turn/journal/hash, child-owned goal, fleet registration, and cmux inbox receipt. It may retrieve parent history lazily. `/commission` must not be substituted for linear continuation or hypothesis branching.


## Long-running stream runner

A stream successor owns the **whole prioritized workstream**, not the first feature named in its handoff. It maintains a derived ordered queue over current request/design/research authorities; groups compatible tasks into coherent batches; keeps enough independent subagents running; integrates, gates, and promotes each completed batch; and continues until blocked or context quality requires succession.

At a batch boundary near the provider-anchored context threshold, it creates `/successor` automatically. The handoff carries the full stream objective, ordered active/next/blocked queue, child ownership, changes/proofs, unresolved decisions, and exact next action. The new orchestrator resumes the stream rather than treating the last batch as the goal.

Automatic succession keeps the predecessor process/tab alive and addressable so Arthur can inspect, ask questions, or compare decisions. Mark it reviewable/parked in projections without destroying its conversational endpoint. Maintain a bounded recent review chain; an unreviewed predecessor is never silently closed. Explicit operator review/retirement or `--retire-source` may close an older view only after durable journal, handoff, genealogy, and successor health receipts exist.

## Caps and cleanup

Active visible sessions are bounded per workstream. Starting a command that exceeds the cap requires choosing an **already reviewed** source to park/retire or branches to converge; never silently evict an unreviewed predecessor. Park preserves the live conversational endpoint plus lineage/journal; retire removes the cmux view/process only after durable state, genealogy, review disposition, and successor-health receipts exist.

## Proof contract

Tests must prove:

- all commands place tabs in the existing canonical workspace/pane;
- the linear-successor command starts with bounded handoff/goal and no copied transcript;
- automatic batch-boundary succession preserves the full ordered stream queue and keeps the predecessor alive/addressable/reviewable by default;
- `/fork` preserves source and exact source-entry lineage;
- `/tangent` carries a distinct scoped concern;
- `/converge` cites every source and parks only after successor health;
- `/commission` returns parent control immediately and gives the child its own goal;
- active-session caps, partial-launch cleanup, health gating, persistent actionable notifications, and genealogy reconstruction survive restart.

## Source testimony

Primary discussion:

- session `019f77c0-6bbe-7000-a700-6b07c1e41136`, messages `958c17f6`, `072e7465`, `ac53843d`, `5bc721cc`, `18781384`, `527e9d34` (2026-07-19);
- correction session `019f7869-d126-7000-8823-f9a60934fa11`, messages `a548a16b`, `c967a7d6`, `e1a66ee3` (2026-07-22).

Related implementation/evidence: `streams/harness/attention-control-plane.md`, HR-205/212/218/219, and `packages/genealogy-index/`.
