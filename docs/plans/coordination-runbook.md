# Coordination Runbook

## Purpose

Keep multiple agents/jobs moving in parallel with explicit path ownership, APFS-isolated write workers when available, and coordinator-owned validation/commits.

## Source-of-truth checkout

Main Mac:

```txt
/Users/arthur/agents/web-access
```

Only this checkout should produce tracked commits unless explicitly changed.

## Current workstream docs

Read these first:

1. `docs/state/README.md`
2. `docs/state/video-creative-direction.md` for video/creative/UGC work
3. `docs/plans/README.md`
4. `docs/plans/layered-video-graph.md`
5. lane-specific doc:
   - `docs/plans/pipeline-serialization-format.md`
   - `docs/plans/jimeng-frontend-api-reversal.md`
   - `docs/plans/tts-lipsync-research.md`
   - `docs/plans/pleometric-archive.md`
   - `docs/plans/ai-ugc-format-mining.md`
   - `docs/plans/machine-roles.md`

## Start-of-lane checklist

1. Read `TASKS.md`, `docs/plans/README.md`, this runbook, and the lane-specific plan.
2. Check current dirty state before editing.
3. Claim one owner path family and list excluded paths.
4. Use isolated OMP write workers for implementation slices when practical; use read-only scouts for discovery.
5. If Arthur gives durable new preferences/direction during the lane, update the relevant `docs/state/**` file before handing off.

## Task packet template

Use this shape for non-trivial worker assignments:

```md
# Task

## Owner paths

## Excluded paths / non-goals

## Dirty files to preserve

## Fixtures, artifacts, or state docs to read

## Change

## Parent validation commands

## Handoff format
```

The packet should name package-local checks, not broad repo gates. Workers should not run project-wide typecheck/test/lint; the coordinator validates after integration.


## Repo-wide metadata ledger SOP

Use Markdown for policy and narrative; use a small SQLite ledger for scheduling state.

Markdown stays authoritative for:

- durable instructions and runbooks (`docs/plans/**`, `docs/state/**`)
- design rationale and human-readable QA notes
- long-form proof writeups that a reviewer reads top-to-bottom
- package docs that should remain useful without a local database

SQLite becomes authoritative only for state that agents repeatedly query or mutate:

- task packet status and priority
- owner path claims and excluded paths
- worker/reviewer assignment records
- proof links to QA notes, artifacts, session logs, commits, or ignored data folders
- timestamps for created/claimed/blocked/review-ready/done/stale decisions

Do **not** migrate all small Markdown files at once. The first cut should leave existing docs in place, add stable task IDs where missing, and create ledger rows that point back to those docs. Only move a field into SQLite when an agent needs to filter, claim, skip, or reconcile it mechanically.

### Minimal ledger shape

Keep the initial schema boring enough to inspect with `sqlite3` and update from Rust or TypeScript:

```sql
create table task_packets (
  id text primary key,
  title text not null,
  workstream text not null,
  status text not null check (status in ('next','active','blocked','review','done','parked')),
  priority integer not null default 0,
  source_doc text,
  summary text not null default '',
  created_at text not null,
  updated_at text not null,
  claimed_at text,
  review_ready_at text,
  done_at text,
  blocked_reason text
);

create table packet_paths (
  packet_id text not null references task_packets(id) on delete cascade,
  path text not null,
  kind text not null check (kind in ('owner','excluded','dirty-preserve')),
  primary key (packet_id, path, kind)
);

create table packet_proofs (
  id integer primary key autoincrement,
  packet_id text not null references task_packets(id) on delete cascade,
  kind text not null check (kind in ('qa-note','artifact','session-log','command','commit','review','data-folder')),
  href text not null,
  label text not null default '',
  created_at text not null
);

create table packet_events (
  id integer primary key autoincrement,
  packet_id text not null references task_packets(id) on delete cascade,
  event_type text not null,
  actor text not null default '',
  note text not null default '',
  created_at text not null
);
```

Store timestamps as UTC ISO-8601 text. Avoid JSON blobs in v0 except for append-only raw import payloads; columns above cover the scheduling queries that matter.

### Query/update flow for agents

1. Coordinator imports or refreshes packet rows from `TASKS.md`, QA notes, and known session logs.
2. Worker asks the ledger for the next eligible packet in its workstream, excluding rows already `active`, `blocked`, `review`, or `done`.
3. Claim is an atomic update from `next`/`parked` to `active` with an inserted `packet_events` row.
4. Worker reads owner/excluded paths from `packet_paths`, then works only inside those paths.
5. Worker returns proof links; coordinator records them in `packet_proofs` and moves the row to `review` or `done`.
6. Reviewers query `status='review'`, inspect proof links and changed paths, then write a review proof and final status.

Markdown handoffs should contain the packet ID and enough prose for humans, but the ledger decides whether a future agent should skip, claim, review, or resume the packet.

### Migration path

1. Seed `task_packets` from the active/next/blocked/done tables in `TASKS.md`; keep `TASKS.md` as the human index during the transition.
2. Add `source_doc` and proof links for existing QA notes rather than copying their text into SQLite.
3. Import session-log references as `packet_proofs(kind='session-log')` only when a session affects scheduling or review.
4. Teach coordinator tools to write status transitions to SQLite first and regenerate or patch Markdown summaries second.
5. After several clean waves, make `TASKS.md` a generated or manually curated summary of the ledger instead of the scheduling source of truth.

## Worker lane rules

- Edit only the task packet's owner paths.
- Treat dirty files outside those paths as user/other-agent work.
- Write captures/downloads/renders under ignored `data/**` or `artifacts/**`.
- Do not commit, stage, revert, or clean unrelated files.
- Do not edit root `package.json`, root configs, `.omp/**`, `.github/**`, `TASKS.md`, `AGENTS.md`, or `docs/state/**` unless the packet assigns those shared files.
- Do not consume paid quota or trigger live generation unless the run is explicitly approved.
- Stop on auth challenges, CAPTCHAs, account-risk messages, or Jimeng risk-control errors.

## Main Mac tmux sessions

```bash
export CLAUDE_TMUX_SOCKET_DIR="${TMPDIR:-/tmp}/claude-tmux-sockets"
mkdir -p "$CLAUDE_TMUX_SOCKET_DIR"
export SOCKET="$CLAUDE_TMUX_SOCKET_DIR/claude.sock"

tmux -S "$SOCKET" new -d -s serialization -n shell 'cd /Users/arthur/agents/web-access && exec bash'
tmux -S "$SOCKET" new -d -s jimeng-reversal -n shell 'cd /Users/arthur/agents/web-access && exec bash'
tmux -S "$SOCKET" new -d -s tts-lipsync -n shell 'cd /Users/arthur/agents/web-access && exec bash'
tmux -S "$SOCKET" new -d -s pleometric-archive -n shell 'cd /Users/arthur/agents/web-access && exec bash'
```

Monitor:

```bash
tmux -S "$SOCKET" capture-pane -p -J -t jimeng-reversal:0.0 -S -200
```

Attach:

```bash
tmux -S "$SOCKET" attach -t jimeng-reversal
```

## Remote desktop / Framework tmux sessions

Desktop GPU worker:

```bash
ssh desktop 'export CLAUDE_TMUX_SOCKET_DIR="${TMPDIR:-/tmp}/claude-tmux-sockets"; mkdir -p "$CLAUDE_TMUX_SOCKET_DIR"; tmux -S "$CLAUDE_TMUX_SOCKET_DIR/claude.sock" new -d -s desktop-gpu -n gpu "cd /home/arthur && exec bash"'
```

Framework archive worker:

```bash
ssh framework 'export CLAUDE_TMUX_SOCKET_DIR="${TMPDIR:-/tmp}/claude-tmux-sockets"; mkdir -p "$CLAUDE_TMUX_SOCKET_DIR"; tmux -S "$CLAUDE_TMUX_SOCKET_DIR/claude.sock" new -d -s pleometric-archive -n archive "cd /home/arthur && exec bash"'
```

Monitor remote:

```bash
ssh desktop 'tmux -S "${TMPDIR:-/tmp}/claude-tmux-sockets/claude.sock" capture-pane -p -J -t desktop-gpu:0.0 -S -200'
ssh framework 'tmux -S "${TMPDIR:-/tmp}/claude-tmux-sockets/claude.sock" capture-pane -p -J -t pleometric-archive:0.0 -S -200'
```

## Status file template

Use status files under `data/coordination/` only for long-lived lanes or cross-machine handoffs. Task packets and final handoffs are enough for short OMP subagent waves.

```md
# <Lane> Status

## Current objective

## Owner paths

## Dirty files intentionally preserved

## Last command/run

## Findings

## Artifacts created

## Blockers / needs coordinator

## Next safe action
```

## Merge-point checklist

Before coordinator integrates lane output, review:

- tracked files changed
- ignored artifacts created
- commands run by workers, if any
- package-local validation still needed
- paid/live provider usage, if any
- unrelated dirty chunks preserved
- risks or account-impacting events

Then run the smallest command set that proves the integrated change. Use package-local checks first; reserve `bun run check` for broad releases or shared-surface refactors.
