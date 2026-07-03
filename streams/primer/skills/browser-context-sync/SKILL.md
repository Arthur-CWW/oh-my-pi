---
name: browser-context-sync
description: "Query and maintain Arthur's local browser-context SQLite built from Firefox/Chrome sessions, Tree Style Tab trees, raw attention events, and the self-instrumentation/shared-memory vision."
---

# Browser Context Sync

## Purpose

`browser-context-sync` narrows the arbitrary boundary between Arthur's browser exploration and OMP agent work. Browser tabs, searches, session trees, source trails, and forgotten follow-ups are part of Arthur's working memory; agents should be able to query that context without Arthur restating it manually.

The project at `~/exploratory/browser-context-sync` passively mirrors browser session context into `~/state/browser-context/browser_context.sqlite` without modifying browser profiles.

## Larger thesis

The deeper goal is self-instrumentation, not browser history. Arthur wants a materialized data source that helps him and agents understand how attention, curiosity, avoidance, research, taste, and follow-through actually behave over time.

This should function like a shared memory surface between Arthur and the agents he works with most often. OMP, Codex, Obsidian, browser sessions, and SRS should not feel like separate silos. The system should help agents infer the background of a task: what sources inspired it, what search trails led there, what concepts were half-learned, what was probably mindless drift, and what Arthur repeatedly cares about.

The useful end state is not Tiago-Forte-style second-brain busywork. It is a low-friction externalized intuition layer: encode tacit preferences, source trust, recurring interests, neglected ideas, and personal failure modes without requiring Arthur to constantly organize notes by hand.

Desired assistant posture: helpful executive assistant, mentor, friend, fellow explorer, and researcher; "cyborgmaxxing" by keeping human browser exploration and agent work in one shared memory surface.

## Persistent patterns to detect and support

1. Late-night drift: after a certain time at night, impulse control drops and browsing becomes less intentional. The system should identify this from raw focus/idle/session events and make it visible without moralizing.
2. Concept capture without re-engagement: Arthur sees an interesting word/concept/account/paper, searches it, gets the gist, then never re-engages. These should become candidates for SRS, resurfacing, or follow-up reading.
3. Manual research with diminishing returns: Arthur searches many sites by hand because source-quality rules are tacit. The system should learn trusted sources/accounts so agents can research in Arthur's style.
4. High-signal account loops: recurring Twitter/X accounts encode taste and trust. Model them as source-preference data, not just URLs.
5. Intent ambiguity: browser history does not say why Arthur searched something. Preserve enough raw context for later interpretation instead of pretending every visit has the same meaning.
6. Too much intake, not enough exploitation: weekly review should identify neglected but promising threads, not merely summarize consumption.

## Weekly routine this should enable

A weekly agent routine should ask:

- What topics did Arthur spend real attention on?
- Which late-night sessions look like low-intent drift?
- Which searches led to concept discovery but no later re-engagement?
- Which sources/accounts were repeatedly used as trusted commentary?
- Which open tab trees map to ongoing OMP/Codex work?
- Which ideas look worth resurfacing, annotating, adding to SRS, or turning into a concrete project/task?
- Where did research hit diminishing returns and should have been delegated to an agent?

The output should be a small set of useful prompts and follow-ups, not a giant quantified-self dashboard.

## Data posture

Store observations. Derive interpretations later.

Raw facts worth preserving: tab/window focus transitions, tab creation/update/move/remove, selected tab per window, idle/AFK state, browser session/tree/group structure, visit parent chains from Firefox history, URLs/titles/timestamps, source account/domain identity, explicit annotations.

Derived later, not persisted as source truth: dwell time, importance, mindless versus intentional browsing, source quality, resurfacing priority, SRS candidacy.

## Commands

From `~/exploratory/browser-context-sync` with `PYTHONPATH=src`:

```bash
python3 -m browser_context_sync sync --browser firefox --once
python3 -m browser_context_sync query current-tree --browser firefox --limit-windows 2
python3 -m browser_context_sync query recent-visits --browser firefox --limit 50
```

## Core tables

`profiles`, `snapshots`, `windows`, `tabs`, `tab_entries`, `tab_tree_edges`, `tab_groups`, `tab_group_memberships`, `events`.

`events` stores raw event facts: `event_type`, `observed_at` (epoch ms), `browser`, `profile_id`, `window_source_id`, `tab_source_id`, `url`, `title`, and `payload_json` for event-specific fields. The importer stores raw facts only; it does not compute dwell, attention scores, importance scores, or summaries.

## When to read Firefox `places.sqlite` directly

Read Firefox `places.sqlite` read-only only when needing history older than the most recent snapshot, visit-parent chains, or transition types (`moz_historyvisits.visit_type`, `moz_historyvisits.from_visit`).

## Do not

- Write to `browser_context.sqlite` from agent code.
- Modify Firefox/Chrome profile databases.
- Pre-compute attention or dwell scores inside the importer.
