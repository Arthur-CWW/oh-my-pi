---
name: thread-garden
description: Human-triggered synthesis of a high-signal OMP thread into the repository's current decisions, design notes, backlog/research/error ledgers, preferences, and handoff state. Use only when Arthur explicitly asks to garden, serialize, sync, or close out a thread.
---

# Thread Garden

This is a **human-controlled commit point**, not an automatic end-of-turn summary. Its job is to integrate a high-signal conversation into the repo without dumping the transcript or turning speculation into law.

## Trigger and scope

Run only on Arthur's explicit request. Confirm the source session/range; default to the current session since its last garden receipt. If the thread is long, use context-bearing retrieval: find by remembered quote, pin/read by stable message ID, and search later corrections. Cheap subagents may extract evidence by topic; the parent session owns synthesis and final review.

## Inventory every state class

Extract and reconcile:

1. **Settled decisions/invariants** → the one current architecture/state authority.
2. **Fleshed-out deferred designs** → a linked design note with semantics, examples, invariants, open questions, and transcript pointers; the register row stays concise.
3. **Actionable backlog** → stable request IDs, priority, status, acceptance, owner/blocker, and link to the design note.
4. **Research/watchlist/icebox** → question, evidence, falsification or promotion trigger, and explicit non-action.
5. **Errors/friction/incidents** → evidence report/cluster, affected build/model/provider where known, disposition link, regression requirement, fixed digest when proven.
6. **Non-functional requirements and durable Arthur preferences** → generator (why/scope/date/provenance), not an absolutized quote.
7. **Implemented work** → changed artifacts, tests/proofs actually observed, candidate/blessed version, rollout/restart state.
8. **Superseded or duplicate docs/rows** → mark historical/absorbed and link current authority; preserve evidence.
9. **Continuation state** → current objective, next action, blockers, live workers, predecessor/successor pointers, and exact review surface.

## Evidence discipline

Classify each source as: Arthur decision, Arthur correction, Arthur speculation, assistant recommendation, tool/config evidence, external source, or superseded statement. Later explicit correction and live config/tool evidence outrank earlier prose. Do not promote assistant synthesis unless Arthur accepted it.

High-signal course corrections deserve exact transcript message pointers when available. Do not paste large transcript excerpts into design docs; preserve short quotes only where wording itself is load-bearing.

## Repository integration

- Update existing owner-local authorities before creating files.
- When a deferred item has substantial back-and-forth, create one named design note and make all register rows point to it rather than duplicating fragments.
- Keep runtime snapshots out of durable prose unless they are dated evidence.
- Retire stale locator rows encountered while writing.
- Never use `AGENTS.md` as a dumping ground; push enforceable behavior into schema/lint/runtime guardrails and record only irreducible judgment.
- Avoid edit conflicts: extraction workers are read-only; the parent/integrator owns canonical document edits.

## Garden receipt

Write a concise dated receipt under `docs/state/thread-gardens/` containing:

- source session ID and covered message/time range;
- current-authority files updated;
- design notes created/updated;
- backlog/research/error/preference rows added, changed, absorbed, or closed;
- unresolved contradictions and Arthur decisions still needed;
- implementation/proof/promotion state;
- exact next action and successor/handoff pointer.

Return only the important review queue in chat: decisions Arthur must inspect, material risks, and next action. Everything else stays in the receipt/docs.

## Completion check

Before declaring the garden complete:

- every significant topic from the covered range is represented or explicitly classified as no-action;
- fleshed-out designs are not compressed only into one ledger row;
- no speculative idea became settled architecture;
- no duplicate current authority was created;
- errors retain a closure/proof path;
- links resolve;
- the next session can resume from repo state without replaying the whole transcript.
