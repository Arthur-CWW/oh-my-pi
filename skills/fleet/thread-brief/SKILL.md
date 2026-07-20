---
name: thread-brief
description: Produce the canonical AWAY-BRIEF for a session/thread — everything a returning human or a peer meta-orchestrator needs to resituate without reading the transcript. Use when Arthur returns to a long-idle thread, when another agent requests a stream brief over IRC, or when a control-plane orchestrator inventories threads it does not own.
---

# Thread Brief (AWAY-BRIEF v1)

One schema, two consumers: Arthur returning to a thread (`/brief` command), and agent-to-agent stream briefs (a peer or meta-orchestrator asks over IRC). Always produce the SAME sections in the SAME order so readers can scan on shape alone. Never pad; empty sections say `— none`. Runtime status is request-time evidence, not durable prose.

## Away clock (compute first, header line)

1. Find the timestamp of the LAST HUMAN INPUT in this session's journal (`:session` shows the journal path; user records carry timestamps). If invoked A2A for another session, use that session's journal path from `omp fleet overview --json`.
2. Header: `AWAY 6h42m (last human input 2026-07-17 21:33 → now 2026-07-18 04:15) · <session name> · <workstream/goal>`.
3. If the away-window is under ~30 min, say so and compress everything below to a single paragraph — a full brief for a coffee break is noise.

## Sections (fixed order)

### 1. Decision queue — what needs the reader NOW
Ranked. Each item: one line + why it blocks + where to act (file, session, command). Pending `ask` prompts first, then approvals/gates, then choices that unblock parked work. This section exists so the reader can act without reading further.

### 2. Review surfaces & artifacts — complete review inventory
Inventory EVERY relevant output produced or changed since the away clock/current deliverable, not samples: live/runnable UIs, proof bundles, video, screenshots/images, reports/docs, data/manifests, logs, and other outputs. Group by type when numerous and use index pointers, but completeness of the inventory wins over the under-40-line target. Every entry has an exact path/URL and a one-click/review action (`open`, `play`, `inspect`, `tail`, or the applicable action); if there are no live UIs or artifacts, say `— none`.

For every registered service or website relevant to the thread, list separately: `human review URL` (or `— none`), `health endpoint` (or `— none` when the registry has only a command), current `health result` plus `running/ownership`, `checked-at` time plus evidence, exact bring-up `cwd` + `cmd` from `services.yml` when down, and the app's error-log path/state when applicable. Source registry facts from `services.yml`; obtain live state with a fresh `bun scripts/streams.ts status <stream>` and never infer health from a URL or stale prose.

### 3. Delta while away
What happened since the away-clock started, compressed to outcomes, never play-by-play:
- Work completed (commits with ids if any; artifacts written with paths)
- State transitions (subagents spawned/finished/failed/parked; goal/todo changes)
- Errors and incidents (anything in `:errors`, crashes, quota blocks) — include resolved ones with one-word dispositions
- Messages received (IRC from peers/other sessions, replies still owed)

### 4. Current state
- Objective + goal status; current todo head
- In-flight right now: running subagents (id, what, how long), pending tool operations
- Blocked on: exactly what, since when

### 5. Cross-thread context (meta-orchestrator lens)
Only what a control plane needs — consume `omp fleet overview --json`, never other transcripts:
- Which OTHER live sessions touch the same streams/paths (name + objective line)
- Ownership boundaries relevant to this thread (streams/GOAL.md owner paths)
- Anything this thread is waiting on from another thread, or owes another thread

### 6. Depth pointers
Exact references for drill-down, so the brief never inlines bulk: journal path, `history://<id>`, key artifact/doc paths touched while away, relevant register rows (HR-ids), the proof bundle/index, and any service/error-log paths. One line each.

## Rules

- Use the precomputed away packet/substrate first. Ground every claim in its contents or in exact journal pointers, todos, goal state, `:errors`, IRC inbox, fleet overview, proof artifacts, `services.yml`, a fresh `bun scripts/streams.ts status <stream>`, or the registered app error logs — never memory alone.
- If the packet lacks any pointers needed to complete the review inventory — artifact paths/URLs, proof outputs or indexes, service/UI references, or relevant error-log pointers — perform one bounded scan of this session's journal, limited to the away-window and only to locate the missing pointer types. This is a pointer lookup, not a journal dump or full re-excavation. Then read only the exact referenced paths/URLs and perform only the explicitly named status/error checks. If the journal tail is all you can read cheaply, say which window you covered.
- Away duration comes from timestamps, not vibes. If exact timestamps are unavailable, state the approximation basis.
- The review inventory must be complete even when that exceeds the terse target: under 40 lines for a day away and under 15 for a few hours are compression goals, not omission permission.
- Keep fast-moving runtime status and checked-at results out of durable prose; report them in this request's brief with their evidence.
- A2A responses: reply over IRC with the same schema; share bulk via `local://` or `history://` references, never pasted blobs. You brief ONLY sessions whose journals you can read; never acquire ownership or send control commands to produce a brief.
- Meta-orchestrator inventory sweeps: run this per thread from `omp fleet overview --json` rows (`session_journal` field), section 5 becomes the overlap/ownership matrix across ALL threads, and section 1 merges into one global ranked decision queue.
