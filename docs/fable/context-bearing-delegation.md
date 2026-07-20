# Context-Bearing Delegation

> **Class:** Doctrine + design state.
> **Owner:** harness stream.
> **Generator:** Arthur's high-signal correction loop on 2026-07-20 (provenance A/A~).
> **Status:** retrieval substrate requested in HR-233; ordinary task packets remain unchanged.

## Intent

Use cheap workers for bulk output without forcing the expensive parent to restate a long conversation or surrender decisions that depend on its uncompressible context.

The parent acts as engineering manager:

1. state the goal and acceptance;
2. reduce avoidable decision entropy;
3. distinguish settled decisions, delegated decisions, and escalation triggers;
4. point to exact retrievable evidence instead of pasting the corpus;
5. retain final synthesis for conversation-derived architecture;
6. require direct file output plus a short evidence receipt.

This is opt-in. Normal bounded code/mechanical tasks keep the existing `context` + `assignment` packet.

## Packet shape

```yaml
goal: Serialize the federated control-plane decision
settled:
  - Canonical content stays near its owner.
delegate_may_decide:
  - Heading structure and concise wording.
must_escalate:
  - Conflicting user decisions or a new architecture commitment.
sources:
  - uri: history://Main
    anchors:
      - quote: "derived workspaces"
        speaker: user
        required: true
    retrieval:
      full_turn: true
      find_later_corrections: true
output:
  write: docs/fable/federated-control-plane.md
  receipt: [files, source_message_ids, unresolved_conflicts]
```

The runtime tool remains typed JSON; YAML is an optional human-editable projection, not a second task language.

## Retrieval rule

**Find by remembered quote; pin and cite by stable message/turn ID.**

Substring anchors are the authoring UX. Search returns speaker, timestamp, snippet, stable IDs, and neighbors. The worker reads full turns by ID and searches for later correction/reversal before treating a claim as current.

Evidence precedence follows `docs/fable/epistemics.md`: current config/tool evidence; later explicit Arthur correction; direct Arthur decision; accepted synthesis; assistant recommendation; speculation; superseded material.

Current blocker: `read(history://Main)` returns a concise projection, while `search(history://Main)` resolves and skips the oversized raw JSONL. HR-233 owns a composable decoded resource: preferably virtual `history://<target>/transcript.md` and/or `messages.jsonl` paths that ordinary `read`/`search` can consume, with an authorized materialized local path when `jq`/`fzf` is useful. Query-string search/record operations may remain a bounded convenience, not the only interface.

## Escalation

Self-serve first: declared sources → anchor search → later corrections → linked tool/file evidence. If a decision-changing ambiguity remains, send one structured IRC request:

```text
Need: <decision>
Tried: <sources/queries>
Conflict: <evidence>
Options/default: <bounded fork>
```

IRC is the live exception channel; `local://`/artifacts carry bulk; transcript/history is evidence; canonical files hold accepted state. All belong to the task receipt rather than competing as context authorities.

## Output-token economics

The cheap worker writes bulk content directly to disk. Its final response is a short receipt. The expensive parent reads the file/diff as input, checks cited decisions, and makes targeted corrections instead of producing a second full draft.

Delegation is not useful when the parent must rewrite the entire corpus into the spawn prompt. It is useful when work is parallel/mechanical or the worker can retrieve exact source context.

## Lints after retrieval proves useful

Hard checks: required anchor resolves; ambiguous anchor disambiguated; source accessible; target owned; responsibility may edit; acceptance present; model/role enabled.

Warnings: giant inline context; no later-correction search; assistant prose used as authority; context-heavy canonical write without evidence receipt; unnecessarily long child final output.

Do not build a bespoke Rust LSP or prompt DSL first. The durable primitives are the typed packet, searchable transcript, stable references, lint rules, escalation channel, and receipts; implementations may improve with stronger models/tooling.

## Evaluation

Test corrections, not only needle retrieval: early A, assistant elaboration, stale doc supporting A, later Arthur rejection, tool evidence, final B. Success means reconstructing B with provenance and retaining A only as historical exploration.
