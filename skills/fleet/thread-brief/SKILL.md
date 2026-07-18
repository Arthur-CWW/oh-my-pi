---
name: thread-brief
description: Produce the canonical AWAY-BRIEF for a session/thread — everything a returning human or a peer meta-orchestrator needs to resituate without reading the transcript. Use when Arthur returns to a long-idle thread, when another agent requests a stream brief over IRC, or when a control-plane orchestrator inventories threads it does not own.
---

# Thread Brief (AWAY-BRIEF v1)

One schema, two consumers: Arthur returning to a thread (`/brief` command), and agent-to-agent stream briefs (a peer or meta-orchestrator asks over IRC). Always produce the SAME sections in the SAME order so readers can scan on shape alone. Never pad; empty sections say `— none`.

## Away clock (compute first, header line)

1. Find the timestamp of the LAST HUMAN INPUT in this session's journal (`:session` shows the journal path; user records carry timestamps). If invoked A2A for another session, use that session's journal path from `omp fleet overview --json`.
2. Header: `AWAY 6h42m (last human input 2026-07-17 21:33 → now 2026-07-18 04:15) · <session name> · <workstream/goal>`.
3. If the away-window is under ~30 min, say so and compress everything below to a single paragraph — a full brief for a coffee break is noise.

## Sections (fixed order)

### 1. Decision queue — what needs the reader NOW
Ranked. Each item: one line + why it blocks + where to act (file, session, command). Pending `ask` prompts first, then approvals/gates, then choices that unblock parked work. This section exists so the reader can act without reading further.

### 2. Delta while away
What happened since the away-clock started, compressed to outcomes, never play-by-play:
- Work completed (commits with ids if any; artifacts written with paths)
- State transitions (subagents spawned/finished/failed/parked; goal/todo changes)
- Errors and incidents (anything in `:errors`, crashes, quota blocks) — include resolved ones with one-word dispositions
- Messages received (IRC from peers/other sessions, replies still owed)

### 3. Current state
- Objective + goal status; current todo head
- In-flight right now: running subagents (id, what, how long), pending tool operations
- Blocked on: exactly what, since when

### 4. Cross-thread context (meta-orchestrator lens)
Only what a control plane needs — consume `omp fleet overview --json`, never other transcripts:
- Which OTHER live sessions touch the same streams/paths (name + objective line)
- Ownership boundaries relevant to this thread (streams/GOAL.md owner paths)
- Anything this thread is waiting on from another thread, or owes another thread

### 5. Depth pointers
Exact references for drill-down, so the brief never inlines bulk: journal path, `history://<id>`, key artifact/doc paths touched while away, relevant register rows (HR-ids). One line each.

## Rules

- Ground every claim in the journal, todos, goal state, `:errors`, IRC inbox, or fleet overview — never memory alone. If the journal tail is all you can read cheaply, say which window you covered.
- Away duration comes from timestamps, not vibes. If exact timestamps are unavailable, state the approximation basis.
- The brief is TERSE: target under 40 lines for a day away, under 15 for a few hours. Compression beats completeness; depth lives in the pointers.
- A2A responses: reply over IRC with the same schema; share bulk via `local://` or `history://` references, never pasted blobs. You brief ONLY sessions whose journals you can read; never acquire ownership or send control commands to produce a brief.
- Meta-orchestrator inventory sweeps: run this per thread from `omp fleet overview --json` rows (session_journal field), section 4 becomes the overlap/ownership matrix across ALL threads, and section 1 merges into one global ranked decision queue.
