# Pi agent control plane / cockpit spec

Status: living draft v0
Owner: Arthur + Pi
Scope: local control plane for managing Pi/OMP/Codex-like agent sessions. Two linked workstreams: `control-plane-core` (SQLite/event/session/task ledger plus runner API) and `dream-memory` (delayed evidence/promotion stream). Runtime substrate is chosen by a small vertical spike: reuse existing Rust/TS only if it stays simpler than an Elixir/OTP core. OMP collab is an optional `live attach/watch/steer channel`, never the source of truth.

## Why this exists

The current pain is not mainly tmux colors or status-line formatting. The real problem is human attention cost when supervising many concurrent Pi sessions.

Symptoms:

- too many generic tmux tabs with redundant names
- poor discoverability of which session is doing what
- high context-switching cost when monitoring many agents
- no central live registry of active Pi sessions
- no trustworthy human review surface for each agent run

This project aims to turn a pile of tmux tabs into a small local **agent control plane**.

## Core idea

Split the system into three layers:

1. **Publisher extensions** inside each Pi session
   - publish session metadata and state
2. **Deterministic control plane**
   - aggregate cross-process runtime state
   - own workgroups, roles, and session membership
3. **Clients**
   - tmux popup cockpit
   - orchestrator Pi session
   - later: richer dashboard or remote status surface

The orchestrator chat/session is **not** the source of truth. It is a client of the control plane.

## Collab reuse boundary

OMP/SymphonyX collaboration features are an optional `live attach/watch/steer channel` across sessions. They are useful for:

- live attach to a running child agent
- watch progress without owning the session
- steer or interrupt within the runner's native capabilities

They are explicitly **not**:

- the source of truth for workflow state
- a registry or database
- a durable transcript store or task queue
- a learning store

Durable state lives in the repo-local SQLite/event/session/task ledger. Store only view links/evidence handles/credential references in the ledger by default, never full collab write links.

## Problem statement

Arthur wants to manage a group of long-running agent sessions in a way that is:

- fast like terminal workflows
- legible like a GUI
- scriptable like tmux
- extensible like Pi extensions
- structured enough to support orchestrator and reviewer agents

The system should support:

- fast switching between many agent sessions
- grouping sessions into working groups
- seeing current state at a glance
- opening a deeper human review view for one session
- eventually supervising orchestrated multi-agent work, not just raw tabs

## Key design insight

The horizontal tmux status line is a **summary surface**, not the control plane.

The real control plane should live in a structured vertical/searchable UI.

```txt
status line  = tiny, stable, glanceable
popup cockpit = searchable, grouped, navigable, previewable
review mode   = inspect one session deeply
orchestrator  = natural-language manager over the same runtime state
```

## Work routing quadrant

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
      one-off Pi chat             │       queue/worktree/review packet
      maybe no control plane      │       control plane most useful
                                  │
                                  ▼
                            easy / routine
```

Implications:

- tmux/zellij live attach is mainly for novel + difficult/exploratory work.
- Symphony-style orchestration is mainly for straightforward or well-specified work that can run autonomously.
- The control plane is most valuable when many runs are happening without live human supervision.
- Exploratory sessions still benefit from titles, status, and grouping, but may not need heavy orchestration.
- The system should route work to the right execution mode instead of treating every task as an interactive tab.

## Current platform facts

- Pi has session files and session APIs, but **no built-in cross-process live registry**.
- Pi has per-process UI hooks like `ctx.ui.setTitle(...)`, `ctx.ui.setStatus(...)`, and `ctx.ui.setFooter(...)`.
- tmux already provides a popup primitive, capture-pane, and chooser-like interactions.
- current tmux window naming is mostly derived from pane title / cwd and is too redundant.

Implication:

- we must build the central cross-process registry ourselves
- TypeScript should own the Pi publisher/connector path
- durable orchestration and ledger ownership should follow the Elixir/OTP vs Rust/TS spike, behind the same JSON/SQLite/API contract

## Product framing

Working name candidates:

- Pi cockpit
- Pi control plane
- Pi agent board
- Pi tmux cockpit
- Pi local symphony

Recommended framing:

> A local SQLite-first agent control plane for supervising Pi/OMP/Codex-like runs, with Elixir/Rust/TypeScript clients behind one JSON/SQLite/API contract and tmux/Zellij as optional live attach surfaces.

## Inspiration

Main inspirations:

- OpenAI harness engineering
- OpenAI Symphony
- Codex app parallel threads/worktrees/review surface
- local tmux workflows

Most relevant lessons from Symphony:

- use one authoritative runtime state
- treat work items as primary and sessions as implementation detail
- keep UI secondary to the control plane
- isolate runs/workspaces where possible
- keep policy in-repo

## Design principles

1. **SQLite-first control-plane boundary**: the selected runtime core owns durable SQLite state, process lifecycle, CLI/API contracts, and supervision; TypeScript is used where it has leverage (Pi extension publisher, Pi-specific tools, optional SDK/RPC adapter), and Rust remains a strong TUI/portable-client path.
2. **Local-first**: no remote service required.
3. **Deterministic control plane**: chat/orchestrator is a client, not the authority.
4. **Human attention is the scarce resource**: optimize for supervision cost.
5. **Stable compressed summaries**: status line should not be noisy or jittery.
6. **Search and hint chords beat numeric tabs**: window indexes are not the main navigation model.
7. **Review must be trustworthy**: per-session diff views require isolated worktrees or equivalent provenance.
8. **Graceful degradation**: non-Pi panes and missing metadata should still work.
9. **No LLM in the hot path**: navigation and rendering should not depend on model calls.
10. **Workgroups over raw tabs**: the core object should become a workgroup/run, not a tmux window number.

## Architecture

Current preferred architecture for the next slice is an **Elixir/OTP ledger/orchestration spike behind a stable JSON/SQLite/API contract**, with Rust TUI/client work and the TypeScript Pi connector kept as clients unless the spike fails the acceptance checklist.

```txt
+-------------------------+       +---------------------------+
| Pi worker session       |       | Pi worker session         |
| TS publisher extension  |       | TS publisher extension    |
+------------+------------+       +-------------+-------------+
             |                                    |
             +----------------+  +----------------+
                              v  v
                    +-----------------------+
                    | SQLite control-plane  |
                    | core + JSON/CLI/API   |
                    +----+-------------+----+
                         |             |
                         |             |
              +----------+--+       +--+----------------+
              | terminal     |       | orchestrator Pi   |
              | backend      |       | session + tools   |
              | tmux/zellij/ |       +-------------------+
              | direct pty   |
              +--------------+
```

TypeScript should be used where it has leverage:

- Pi extension publisher
- Pi-specific tool registration
- optional Pi SDK/RPC adapter if the Node APIs are required

The selected control-plane core should own the portable authority:

- runtime registry
- workgroup state
- config parsing
- persistence
- runner orchestration
- terminal/backend attachment abstractions

If Elixir/OTP owns orchestration after the spike, Rust should stay focused on TUI/client duties instead of carrying a second ledger authority.


## System components

### 1. Publisher extension (inside each Pi session)

Responsibilities:

- compute good short title
- publish session state
- track recent activity
- track touched files
- expose role/workgroup metadata
- update tmux-visible title

Initial implementation:

- `packages/web-access/src/agent-cockpit.ts` — SQLite schema/store, session/workgroup/event records, terminal snapshot normalization
- `packages/web-access/src/agent-cockpit-extension.ts` — Pi publisher/tool integration
- `packages/web-access/src/agent-cockpit-cli.ts` — local CLI prototype

### 2. Control-plane daemon

Responsibilities:

- own authoritative live registry
- reconcile heartbeats/session disappearance
- manage workgroups and membership
- expose local read/write API to clients
- support eventual orchestration features

Likely later implementation location:

- `packages/control-plane/**` or a Rust crate once the TS pilot proves the object model

### 3. tmux cockpit client

Responsibilities:

- search and switch between sessions
- display grouped sessions
- show previews and session metadata
- open review mode
- provide hint chords for direct jump

Likely implementation location:

- `packages/tmux-cockpit/**`

### 4. Orchestrator Pi session

Responsibilities:

- conversational management of workgroups
- summarization / coordination / spawn suggestions
- structured tools over control-plane state

This should be a normal Pi session with extra tools, not the source of truth.

### 5. Optional worktree manager

Responsibilities:

- launch new sessions in isolated git worktrees
- make review/diff mode trustworthy
- support role-specific workers later

## Core runtime objects

### Session

```ts
interface SessionRecord {
  sessionId: string
  tmuxTarget?: string
  projectKey: string
  workspacePath?: string
  worktreePath?: string
  branch?: string
  title: string
  role?: string
  groupId?: string
  status: "starting" | "running" | "idle" | "blocked" | "review" | "error" | "done"
  lastHeartbeatAt: string
  lastActivityAt?: string
  lastSummary?: string
  filesTouched?: string[]
  paneTitle?: string
  cwd?: string
  provider?: string
  model?: string
}
```

### Workgroup

```ts
interface WorkgroupRecord {
  id: string
  name: string
  goal?: string
  projectKey: string
  status: "active" | "blocked" | "review" | "done" | "archived"
  priority?: number
  sessionIds: string[]
  createdAt: string
  updatedAt: string
}
```

### Review surface

```ts
interface ReviewRecord {
  sessionId: string
  filesTouched: string[]
  branch?: string
  worktreePath?: string
  recentOutput?: string
  lastSummary?: string
  diffMode: "none" | "repo" | "worktree-trustworthy"
}
```

## Workgroups

Workgroups are a first-class grouping abstraction.

A workgroup is not just “all tabs in the same cwd”. It is a semantic cluster such as:

- search revamp
- jimeng reversal
- reviewer pass for UGC CLI
- orchestration experiments

A workgroup may include roles like:

- orchestrator
- planner
- implementer
- reviewer
- QA
- monitor

Initial grouping may be manual or semiautomatic.

Longer term, workgroups may be created by:

- direct user action in cockpit
- orchestrator tools
- issue/task imports
- launch templates

## UI surfaces

### 1. tmux status line (compressed summary only)

Goals:

- preserve current tmux workflow
- avoid repeated cwd spam
- show short distinctive labels
- show state icon before title
- optionally compress multiple sessions in one project/workgroup

Example shape:

```txt
[web] ◐ asset  ○ jimeng  ○ review  +4   [auto] ○ main
```

Status line rules:

- no repeated full repo name on every tab
- state icon first
- title only shows distinctive task text
- overflow collapses to `+N`

### 2. Popup cockpit (primary navigation UI)

Goals:

- vertical searchable list
- grouped by project/workgroup
- preview on selection
- hint chords for instant switch
- keyboard-first human UX

Sketch:

```txt
┌──────────────────── Agents ────────────────────┐
│ Search: jim                                    │
│                                                │
│ Group / project                                │
│ search revamp                                  │
│   jk  ◐  asset-library                         │
│   jl  ○  jimeng-reversal                       │
│   j;  !  reviewer-1                            │
│                                                │
│ Preview                                        │
│ recent pane output / last summary / blockers   │
│                                                │
│ Enter switch • Tab review • / search • Esc     │
└────────────────────────────────────────────────┘
```

### 3. Review mode

Purpose:

- inspect one agent run deeply
- show touched files, branch/worktree, output, summary
- later show trustworthy diff when backed by isolated worktree

Sketch:

```txt
┌ meta ────────┬──────── changed files / diff ────────┐
│ ◐ running    │ src/foo.ts   +23 -4                 │
│ branch: ...  │ src/bar.ts   +12 -0                 │
│ worktree: .. │ ...                                 │
│ last: 20s    │                                     │
├ recent output┼─────────────────────────────────────┤
│ tool calls / last assistant summary / blockers     │
└──────────────┴─────────────────────────────────────┘
```

### 4. Orchestrator session

Purpose:

- user can talk to a dedicated “manager” agent
- group sessions into workgroups
- inspect progress across groups
- spawn review/planning sessions later
- summarize blockers and stale runs

Example requests:

- “group these 4 sessions into search revamp”
- “show blocked sessions”
- “rename the generic pi-web-access sessions based on recent intent”
- “create a reviewer session for workgroup A”

## Navigation model

Do not rely on tmux window numbers as the main navigation primitive.

Preferred interaction:

- `prefix + g` opens cockpit
- type to search
- `j/k` move selection
- `Enter` switches to session
- `Tab` opens review mode
- hint chords allow direct switch without arrowing

### Hint chord design

Reasoning:

- `Ctrl+1..9` is ergonomically poor
- left-hand numeric navigation does not scale
- right-hand-only chords are better for repeated switching

Initial idea:

- use deterministic visible two-key hints from a right-hand-friendly alphabet
- assign hints in the popup, not permanently in the status line

Candidate alphabet:

```txt
j k l ; u i o p n m , .
```

## Naming strategy

Order of precedence for a session title:

1. manual title override
2. explicit Pi session name
3. derived short task title from recent user intent
4. fallback to repo/workspace name

Rules:

- prefer short distinctive nouns/phrases
- avoid repeating repo name unless needed for disambiguation
- update on task boundary, not every tool call
- allow an icon/state prefix

Example titles:

- `◐ asset-library`
- `○ jimeng-reversal`
- `! reviewer-blocked`
- `○ automations-main`

## Review truth model

Important constraint:

A per-session git diff is only trustworthy if the session is isolated from other sessions, typically via a worktree or equivalent dedicated checkout.

Therefore:

- no worktree -> review mode may show touched files, recent output, summary, and repo diff caveats
- isolated worktree -> review mode may show trustworthy session-specific git diff

This implies that deeper review features should push the system toward one-worktree-per-session or one-worktree-per-workgroup.

## Runtime core choice: Elixir/OTP, Rust, or TypeScript

A Rust core remains attractive if this becomes primarily a standalone local CLI/TUI project.

Benefits:

- single fast native binary for daemon + CLI + cockpit TUI
- strong fit for terminal UIs (`ratatui`/`crossterm`) and process management
- easier distribution without Node/Bun runtime assumptions
- good filesystem/config/state robustness
- safer long-running daemon behavior than ad-hoc scripts
- cleaner remote/SSH/process abstractions if designed early

Costs:

- Pi extension APIs are TypeScript, so a TS connector remains necessary
- Pi SDK integration may be easier in TypeScript; Rust may need to talk through JSON/RPC/stdio/local HTTP
- more initial scaffolding than a small TS prototype
- if the project remains Pi-specific, Rust may be premature

Recommendation:

- run the Elixir/OTP vertical spike first because the active Symphony Lite goal needs supervision, task-source imports, and ledger-backed orchestration
- keep Rust as the TUI/portable-client path unless the spike shows Rust should own the durable core
- keep a thin TS Pi extension that publishes events and exposes Pi tools
- keep all runner/terminal backends behind explicit interfaces so the core is not Pi-locked

## Metadata storage: Zellij/tmux vs our SQLite

Zellij exposes useful terminal/session metadata, but it should not be the authoritative store for Pi/workgroup metadata.

Zellij can provide:

- sessions/tabs/panes
- active tab/pane state
- pane title
- pane command/cwd in list responses
- plugin events for tab/pane/session updates
- pipe messages for plugin communication
- session metadata/layout cache files

But our domain metadata should live in our own store:

- Pi session id
- workgroup id/membership
- role
- current objective
- semantic status
- files touched
- summary
- review packet metadata
- durable links to Pi session JSONL/logs/artifacts

Recommended store:

```txt
~/.local/share/pi-cockpit/cockpit.sqlite
```

or repo-local for early development:

```txt
data/control-plane/cockpit.sqlite
```

Why SQLite:

- one local file
- easy querying from Rust and TypeScript
- durable across terminal multiplexer restarts
- can store event log + current snapshots
- avoids overloading Zellij/tmux names/titles with semantic state
- makes later non-Zellij clients possible

Design rule: Zellij/tmux is the terminal substrate; SQLite is the semantic control-plane memory.


## Repo-wide task metadata ledger

T-2026-06-13-005 should land as a centralized **task metadata ledger**, not a document database and not a second standalone database package.

The control-plane SQLite store owns two related but separate concerns:

1. **runtime cockpit state**: live sessions, terminal panes, heartbeats, workgroups, and recent activity
2. **task metadata state**: packet queue rows, owner path claims, proof links, review state, source pointers, and scheduling timestamps

Keeping both in SQLite lets the orchestrator answer questions like “what is the next unclaimed React QA packet?” or “which active agents own `apps/slotok-workbench/**`?” without rereading `TASKS.md`, QA notes, domain packet ledgers, and session logs. Keeping the concerns separate prevents transient terminal details from becoming the task source of truth.

### Existing seams

Use the seams already in the repo:

- `packages/web-access/src/agent-cockpit*` owns the current cockpit/runtime pilot and `~/.local/share/pi-cockpit/cockpit.sqlite`.
- `packages/symphony-lite-elixir/lib/symphony_lite_elixir/ledger.ex` already has workflow, agent, external-session, event, and packet tables behind the `symphony_lite`/`symphonyx` JSON CLI spike.
- `packages/symphony-lite-rs` remains the Rust/TUI comparison path and future client, not a reason to introduce a parallel task-ledger package.
- `catalog/workspaces.yml` names workspace roots and packet policy; ledger rows should reference those stable roots and packet paths rather than inventing new path semantics.

Do **not** create `packages/task-ledger`, `packages/database-workbench-ledger`, or another SQLite wrapper for this slice. Extend the chosen Symphony Lite ledger seam first; expose boring JSON/CLI commands over it; let the database workbench inspect the resulting SQLite file later as a generic SQLite database.

### What stays Markdown

Do not move every small Markdown file into SQLite. Markdown remains the right format for:

- policy and SOP docs that humans edit directly
- plans with rationale, tradeoffs, and historical context
- QA notes with screenshots, command transcripts, and prose interpretation
- state/lesson docs that should be readable outside the cockpit

The ledger should point to these files by path and stable heading or artifact URL. It should not copy their prose unless a short summary is needed for list views.

### What moves to SQLite first

Move only high-churn coordination fields:

- packet id, title, workstream, status, priority, and short summary
- source pointer: Markdown path/heading, packet-manifest path, or external packet-ledger row reference
- owner paths, excluded paths, and dirty paths that must be preserved
- assigned worker/reviewer/session ids
- proof links to QA notes, artifacts, session logs, data folders, and commits
- created/updated/claimed/review-ready/done/stale timestamps
- append-only status events

These are the fields agents need for atomic claim/update decisions. They are also the fields most likely to become stale when duplicated across `TASKS.md`, QA notes, packet-ledger dashboards, and handoff prose.

### Minimal canonical table list

The first repo ledger needs four scheduling tables alongside the runtime cockpit/workflow tables:

```sql
create table task_packets (
  id text primary key,
  title text not null,
  workstream text not null,
  status text not null,
  priority integer not null default 0,
  source_doc text,
  source_heading text,
  summary text not null default '',
  created_at text not null,
  updated_at text not null,
  claimed_at text,
  review_ready_at text,
  done_at text,
  blocked_reason text
);

create table packet_ownership (
  packet_id text not null references task_packets(id) on delete cascade,
  path text not null,
  kind text not null,
  primary key (packet_id, path, kind)
);

create table packet_proofs (
  id integer primary key autoincrement,
  packet_id text not null references task_packets(id) on delete cascade,
  kind text not null,
  href text not null,
  label text not null default '',
  created_at text not null
);

create table packet_events (
  id integer primary key autoincrement,
  packet_id text not null references task_packets(id) on delete cascade,
  event_type text not null,
  actor text not null default '',
  session_id text,
  note text not null default '',
  created_at text not null
);
```

Use constrained status values in application code first; add SQL `check` constraints once the import path has proved the vocabulary across `TASKS.md`, packet manifests, and existing domain packet ledgers. Store timestamps as UTC ISO-8601 text so shell, TypeScript, Rust, Elixir, and SQLite can all sort them without adapters.

### Migration from existing repo state

1. Import `TASKS.md` rows as `task_packets` with `source_doc='TASKS.md'`; keep the Markdown file as the human index during the transition.
2. Import repo packet manifests and domain packet ledgers as source pointers, not copied prose. For a SQLite packet ledger, store the DB path in `source_doc` and the table/row key in `source_heading`, then add proof links for the artifacts a reviewer needs.
3. Link existing `docs/qa/**` proof notes as `packet_proofs(kind='qa-note')`; do not inline the note body.
4. Link session histories/logs only when they affect scheduling, review, or unblock decisions.
5. For active multi-agent work, add owner/excluded paths from the task packet into `packet_ownership`.
6. Teach coordinator commands to update SQLite first, then patch or regenerate short Markdown summaries.
7. Once the loop is reliable, make `TASKS.md` a curated/generated view of the ledger instead of the place agents race to edit.

This is intentionally incremental. A useful v0 can answer `next`, `claim`, `paths`, `proof add`, `review-ready`, `block`, and `done` before any historical Markdown is fully normalized.

### Agent query/update API

Expose boring commands or tools over the ledger:

```txt
ledger import --source TASKS.md
ledger import --source data/<domain>/<packet-ledger>.sqlite
ledger next --workstream <name> [--path <prefix>]
ledger claim <packet-id> --worker <id> --session <id>
ledger paths <packet-id>
ledger proof add <packet-id> --kind qa-note --href docs/qa/...
ledger status <packet-id> review --note "proof ready"
ledger status <packet-id> done --proof <href>
```

Agents should never infer packet availability from prose when the ledger exists. They query for eligible work, claim atomically, read owner/excluded paths, and write proof/status events. Markdown remains the reviewable explanation layer.

### First implementation slice

The first code slice should extend the existing `packages/symphony-lite-elixir` ledger/CLI rather than adding a package:

1. Add a migration-safe schema update for the four task metadata tables above, preserving any existing rows from the current spike schema.
2. Add a `TASKS.md` importer that maps task id/title/source/summary into `task_packets` and leaves long prose in Markdown.
3. Add a packet-ledger importer interface that can read another SQLite packet dashboard by adapter and store only the source pointer plus proof links.
4. Implement `next`, `claim`, `paths`, `proof add`, and `status` against the same ledger root used by `status --json`.
5. Add one fixture-backed smoke path that imports `TASKS.md`, claims T-2026-06-13-005, attaches this plan update as proof, and returns bounded JSON.

Root should validate that slice with the package-local Symphony Lite Elixir test/smoke command, not with repo-wide gates.

## Zellij API notes

Source inspection shows Zellij has stronger APIs than tmux for cockpit-style integration. Repos inspected:

- `zellij-org/zellij` cloned to `/tmp/pi-zellij-src` at `e9173cba163506491becbeacad162315d6e8f726`
- `zellij-org/zellij-org.github.io` cloned to `/tmp/pi-zellij-website` at `049a2b3639363137007d0d8b6cb0671a60ca5892`

Zellij has website markdown docs under `docs/src/**` in the website repo.

Key findings:

- plugin events include `TabUpdate`, `PaneUpdate`, `SessionUpdate`, `ListClients`, `CwdChanged`, `CommandChanged`, and pane render reports
- `TabInfo` has stable `tab_id`, position, name, active state, dimensions, and pane counts
- `PaneInfo` has id, title, focus/floating/suppressed/exited state, geometry, command, plugin URL, and colors
- CLI actions include listing panes/tabs as JSON, renaming tabs/sessions, writing chars, dumping screen, subscribing to pane output, and piping messages to plugins
- Zellij writes session metadata/layout cache files unless `disable_session_metadata` is enabled

This suggests a possible architecture:

```txt
Zellij plugin/sidebar/status plugin
  reads Zellij tab/pane events
  reads/writes cockpit SQLite
  receives messages from external CLI or Pi publisher

Pi publisher extension
  writes semantic agent metadata to SQLite/API

Rust cockpit CLI/TUI
  queries SQLite
  optionally drives Zellij actions
```

Potential advantage: a Zellij plugin could replace a separate tmux-style popup for navigation/status once the small local pilot proves useful.

## Implemented v0 pilot

A first TS pilot now exists inside `packages/web-access`.

Files:

- `packages/web-access/src/agent-cockpit.ts`
- `packages/web-access/src/agent-cockpit-extension.ts`
- `packages/web-access/src/agent-cockpit-cli.ts`
- `packages/web-access/test/agent-cockpit.test.ts`

Implemented:

- SQLite DB at `~/.local/share/pi-cockpit/cockpit.sqlite` by default
- `cockpit_sessions` table for semantic session metadata
- `cockpit_workgroups` table for manual group metadata
- `cockpit_events` append-only event log
- `terminal_tabs` and `terminal_panes` snapshot tables for Zellij/tmux-like substrate state
- CLI commands: `init`, `publish`, `heartbeat`, `list`, `summary`, `event`, `events`, `workgroup`, `zellij-snapshot`
- Pi tool: `agent_cockpit`
- passive Pi lifecycle publisher for `session_start`, `agent_start`, `turn_start`, `tool_call`, `tool_result`, `agent_end`, and `session_shutdown`
- Zellij snapshot importer using `zellij action list-panes --all --json` and `zellij action list-tabs --all --json`

Try it:

```bash
bun run cockpit init
bun run cockpit publish --id demo --title Demo --status running --workgroup pilot --role worker --objective "try cockpit"
bun run cockpit list
bun run cockpit summary
bun run cockpit zellij-snapshot --session <zellij-session-name>
```

The CLI is also exposed as `pi-cockpit` from `packages/web-access`.

Validation:

```bash
cd packages/web-access && bun test test/agent-cockpit.test.ts
cd packages/web-access && bun run typecheck
```

Current limitation: this is still a local SQLite + CLI/tool prototype, not a long-running reconciler daemon or full TUI.

## Small local pilot: zellij/tmux only

Before building the full control plane, test whether a simpler local workspace is enough.

Pilot shape:

- one zellij/tmux session on Arthur's computer
- one tab/pane per Pi worker
- one tab/pane for the orchestrator Pi session
- manually or script-launched tabs with good names
- use multiplexer attach/detach, layout, and scrollback
- no central daemon initially, only optional Pi publisher metadata

This may be sufficient for running a few agents in parallel when the goal is exploratory supervision rather than autonomous fleet orchestration.

What this pilot does **not** solve well:

- semantic replay/fork across Pi sessions
- trustworthy per-session diffs without worktrees
- durable workgroup state
- autonomous queue/retry/reconcile behavior
- cross-machine registry beyond what the multiplexer can attach to

Decision rule:

- if the work is mostly a few exploratory sessions, prefer zellij/tmux pilot
- if the work becomes many autonomous runs, add the control-plane daemon

## Terminal backend: tmux, zellij, or direct PTY

Terminal multiplexers should be optional backends, not the core architecture.

### tmux / zellij backend

Use an existing multiplexer for live attachment and remote resilience.

Benefits:

- attach/detach is solved
- scrollback/capture is solved
- remote network drops are survivable
- multiple viewers are possible
- user can still manually intervene with familiar terminal tools

Costs:

- extra adapter/config/keybinding layer
- UI is constrained by tmux/zellij semantics
- semantic replay/fork still needs Pi session data, not terminal scrollback

### Direct PTY backend

The Rust core can eventually run workers directly under a PTY.

Benefits:

- no tmux/zellij dependency
- one integrated UI model
- full control over recording, replay, resizing, and input routing

Costs:

- much more implementation complexity
- must build attach/detach, scrollback, resize, signal handling, input forwarding, and remote streaming
- remote sessions become fragile unless a daemon is running on the remote host
- easy to accidentally rebuild a terminal multiplexer badly

Recommendation:

- do not make tmux/zellij mandatory in the domain model
- for the v0 pilot, use tmux because it already solves live attach for current workflows
- design a `TerminalBackend` interface with at least:
  - `none` for RPC/headless workers
  - `tmux` for current local/remote attach
  - `zellij` later if its plugin model becomes compelling
  - `pty` later only if replacing multiplexers is worth the scope

Live attach is valuable, especially for remote sessions. If live remote attach matters, tmux/zellij usually reduce complexity rather than add it. Avoiding them means the Rust core must become a remote PTY multiplexer.

## Non-functional requirements

### Product / UX

- keyboard-first
- fast enough to feel terminal-native
- glanceable status summaries
- low context-switching cost
- human legibility first for the control-plane UI
- chat/orchestrator is optional, not mandatory for basic use

### Technical

- SQLite-first core with stable Elixir/Rust/TypeScript client boundaries
- minimal dependencies
- local-first operation
- deterministic hot path; no LLM needed for navigation
- resilient to missing metadata and non-Pi panes
- no focus stealing except explicit popup open
- stable rendering with dozens of sessions
- clean separation between authority and clients

### Safety / correctness

- review views must clearly indicate trust level of diff provenance
- state reconciliation should tolerate dead panes and crashed sessions
- write actions should be explicit and auditable
- the orchestrator session should not be able to silently mutate state without tool calls

### Performance

- popup open should feel effectively instant
- session discovery should scale to at least dozens of sessions without lag
- preview should avoid excessive shelling or large output churn
- background publishers should have negligible overhead on active Pi sessions

### Extensibility

- support workgroups and roles from day 1 in the data model
- allow future issue-tracker / Linear / GitHub integration
- allow future worktree launcher / orchestrator features
- allow later non-tmux clients

## Runtime substrate checkpoint: Elixir/OTP vs Rust/TS

OTP is Elixir/Erlang's production pattern set for supervised concurrent systems: lightweight processes, message mailboxes, registries, supervisors, restart strategy, application lifecycle, tracing/introspection, and hot-code upgrade/reload support.

OpenAI Symphony's Elixir reference implementation polls Linear, creates a workspace per issue, launches `codex app-server`, keeps Codex working until done or blocked, exposes a Phoenix LiveView dashboard plus a JSON API, and has a `make all` command plus optional live end-to-end tests.

OpenAI's Symphony README labels the Elixir implementation prototype software for evaluation and recommends implementing a hardened version from `SPEC.md`.

The repo should not make the TUI depend on Elixir. The boundary is JSON/SQLite/control API: Elixir may own orchestration; Rust may own TUI; TypeScript may own Pi extension/web/control-panel views.

The next implementation decision is a tiny vertical spike, not a rewrite. Build the smallest core that can run end-to-end and compare code/operational simplicity.

### Spike acceptance

- Start two dry-run child runs from a local task list.
- Persist workflow/session/event rows.
- Expose `status --json` or `/api/state` with bounded previews.
- Mark one worker blocked and one done.
- Simulate one crashed worker and show restart or explicit failed state.
- Run one command that proves the whole path without a TUI.

## Workstreams / packets

### Workstream 1: `control-plane-core`

Durable local control plane and orchestration surface. Owner paths:

- `packages/symphony-lite-rs/**`
- `packages/symphony-lite-elixir/**`
- `packages/web-access/src/agent-cockpit*`
- `docs/plans/pi-agent-control-plane.md`
- `docs/plans/symphony-lite.md`
- `docs/state/symphony-lite-direction.md`

Tasks:

- maintain SQLite/ledger data as source of truth for workflow runs, subagent starts, events, external sessions, and task packet state
- run the Elixir/OTP vs Rust/TS vertical spike before committing to a runtime rewrite
- expose one stable JSON/CLI/API contract for central Pi orchestrator, Rust TUI, and future TypeScript web/control-panel clients
- support Pi RPC and Codex app-server runners
- keep tmux/Zellij materialization lazy/optional for human attach/debugging
- add task metadata ledger (`task_packets`, `packet_ownership`, `packet_proofs`, `packet_events`) imported from `TASKS.md` and existing packet-ledger source pointers
- expose deterministic commands/endpoints: `import`, `next`, `claim`, `paths`, `proof add`, `status`
- keep orchestrator Pi/OMP session as a client, not the authority

### Workstream 2: `dream-memory`

Delayed evidence/promotion stream. Skills, docs, lints, and memory are materialized only after evidence and review. Owner paths:

- future `docs/plans/dream-memory/**`
- `data/dream-memory/**` or equivalent repo-local ledger
- future runtime module/package only after promotion, not inside the first runtime spike

Tasks:

- collect evidence in SQLite/ledger evidence/candidate/proposal tables or equivalent repo-local store
- require review before promoting any candidate to memory/docs/lints/skills
- materialize skills only after evidence and review, never from raw auto-generation
- keep this stream separate from `control-plane-core`; it consumes control-plane events but does not own them
- plan-level in `docs/state/symphony-lite-direction.md`; not currently implemented in the Rust package or Elixir spike

### Link between workstreams

`control-plane-core` produces durable workflow/subagent events; `dream-memory` may read those events as evidence, but promotion decisions write reviewed repo artifacts, not runtime state. Runtime state remains in the control-plane ledger; learning candidates remain in the Dream ledger.

## Open questions

1. Should the control-plane daemon be a long-running process or an on-demand local service started by the cockpit?
2. What local IPC shape is best: JSON file + file watch, unix socket, or simple HTTP on localhost?
3. How much session state should be persisted across restarts?
4. Should workgroups be mostly manual at first, or inferred from session names/launch templates?
5. When should worktrees become mandatory for certain kinds of sessions?
6. Should orchestrator actions be approval-gated?
7. Should the tmux status line itself reflect workgroups, or only the popup?
8. How should remote tmux sessions or SSH-hosted workers fit into the model?

## Vendor / research strategy

We should likely vendor or mirror reference materials for design inspiration, but not depend on a foreign runtime for the v0 pilot.

Recommended:

- vendor the Symphony spec and README as reference material
- adapt ideas into local TS architecture

Possible layout:

```txt
vendor/symphony/
  SPEC.md
  elixir-README.md

docs/research/pi-agent-control-plane/
  README.md
  source-urls.txt
  *.md
```

## Elixir / Symphony adoption notes

Elixir is useful for Symphony because it is excellent at long-running orchestration:

- BEAM lightweight processes make many concurrent workers cheap.
- OTP supervision trees make crash/restart behavior explicit.
- Message passing fits an orchestrator that owns state and receives worker events.
- Phoenix LiveView gives a dashboard/status surface with relatively little code.
- Hot reload and live state inspection are strong during development.

Do a bounded Elixir/OTP vertical spike before a rewrite. If the Elixir spike satisfies the acceptance checklist with less glue and clearer supervision than the existing Rust/TS path, promote Elixir to the orchestration core while keeping Rust TUI and TypeScript/Pi/web clients behind JSON/SQLite/API boundaries. If not, keep Rust/TS and copy only Symphony's architecture.

## Symphony layer breakdown

Symphony is easiest to understand as layered control-plane architecture, not as a UI project.

### 1. Policy layer

Repo-owned instructions that define how agents should do work.

In Symphony:

- `WORKFLOW.md` prompt body
- team workflow rules
- handoff states and proof expectations

For Pi cockpit:

- a repo-owned workflow/control-plane doc
- role prompts for orchestrator, implementer, reviewer, QA
- rules for when work is review-ready, blocked, stale, or done

### 2. Configuration layer

Typed settings derived from repo-owned config and environment.

In Symphony:

- parses `WORKFLOW.md` front matter
- validates tracker/workspace/agent/codex settings
- supports dynamic reload

For Pi cockpit:

- control-plane config
- tmux/zellij adapter settings
- workspace/worktree roots
- concurrency/session limits
- title/status preferences

### 3. Integration layer

Adapters to outside systems.

In Symphony:

- Linear client
- tracker normalization
- issue state fetch/update support

For Pi cockpit:

- tmux adapter
- optional zellij adapter
- Pi session-file reader
- optional GitHub/Linear adapters later

### 4. Coordination layer

The deterministic brain that owns runtime state.

In Symphony:

- orchestrator poll loop
- claimed/running/retry state
- dispatch eligibility
- reconciliation
- backoff/stall handling

For Pi cockpit:

- live session registry
- workgroup membership
- stale/dead session reconciliation
- blocked/review/done state
- future worker dispatch

### 5. Execution layer

Creates workspaces and runs agents.

In Symphony:

- workspace manager
- Codex app-server runner
- hook execution
- subprocess lifecycle

For Pi cockpit:

- launch Pi worker sessions
- optional SDK/RPC-managed Pi runtime
- optional tmux/zellij-attached worker process
- worktree manager for isolated reviewable runs

### 6. Observability / status layer

Human and machine surfaces over runtime state.

In Symphony:

- structured logs
- optional dashboard/API
- runtime state JSON

For Pi cockpit:

- tmux status summary
- popup cockpit
- review mode
- orchestrator Pi tools
- optional local HTTP/JSON API

### 7. Agentic manager layer

This is not a separate Symphony layer in the spec, but it emerges in use: an agent can act as a manager over the deterministic service.

For Pi cockpit:

- the orchestrator Pi session should use tools against the control plane
- it can group, rename, summarize, spawn reviewers, and explain progress
- it should not be the authoritative runtime state itself

## Symphony mapping for Pi

We can reuse most of Symphony's shape with substitutions:

| Symphony concept | Pi control-plane equivalent |
|---|---|
| Linear issue | local workgroup / task / future GitHub or Linear issue |
| Orchestrator runtime state | TS control-plane registry |
| Workspace manager | git worktree/session workspace manager |
| Codex app-server agent runner | Pi SDK/RPC runner or tmux-attached Pi process |
| Codex update events | Pi publisher extension events / RPC events |
| Phoenix dashboard/API | tmux cockpit, orchestrator tools, optional local HTTP API |
| WORKFLOW.md | repo-owned control-plane workflow/policy doc |

The API/application layer should be replaceable. tmux or zellij can be the live attachment/status surface while the control plane stays independent.

## Agent-runner abstraction

To make the design agnostic to Pi or Codex, define a small control-plane-facing runner interface and implement adapters.

The control plane should not know whether a worker is Codex, Pi, Claude Code, a shell command, or a remote SSH worker. It should only know about normalized lifecycle events and capabilities.

```ts
interface AgentRunner {
  kind: string
  capabilities: AgentRunnerCapabilities
  start(input: AgentStartInput): Promise<AgentHandle>
  attach?(target: AgentTarget): Promise<AttachInfo>
  stop(target: AgentTarget, reason: string): Promise<void>
  resume?(target: AgentTarget): Promise<AgentHandle>
  fork?(target: AgentTarget, fork: ForkRequest): Promise<AgentHandle>
}

interface AgentRunnerCapabilities {
  liveEvents: boolean
  semanticReplay: boolean
  forkSession: boolean
  attachTerminal: boolean
  worktreeIsolation: boolean
  programmaticInput: boolean
}
```

Normalized events:

```ts
type AgentEvent =
  | { type: "started"; runId: string; target?: AgentTarget }
  | { type: "heartbeat"; runId: string; at: string }
  | { type: "status"; runId: string; status: SessionRecord["status"]; message?: string }
  | { type: "tool"; runId: string; name: string; paths?: string[]; summary?: string }
  | { type: "tokens"; runId: string; input?: number; output?: number; cost?: number }
  | { type: "needs_input"; runId: string; reason: string }
  | { type: "finished"; runId: string; outcome: "done" | "error" | "cancelled" }
```

Initial adapters:

| Adapter | What it uses | Strength | Weakness |
|---|---|---|---|
| `pi-publisher` | existing interactive Pi + extension | easiest for current tmux workflow | cannot fully control process lifecycle |
| `pi-rpc` | Pi RPC mode / SDK runtime | best for programmatic orchestration | less native interactive TUI unless mirrored into tmux |
| `codex-app-server` | Codex app-server JSON-RPC | closest to Symphony reference model | Codex-specific |
| `tmux-process` | tmux process + capture-pane/send-keys | works with anything terminal-based | semantic replay/fork are weak |
| `zellij-process` | zellij plugin/process APIs | richer terminal plugin path | migration cost and keybinding changes |

Design rule: the control plane is agent-runner agnostic; Pi is the first runner adapter, not a hard-coded assumption.

## Three integration modes for Pi

### 1. Observe existing Pi sessions

- user starts Pi normally in tmux
- Pi extension publishes metadata/events
- cockpit can switch/preview/review based on registry + session files

Best v0 pilot path.

### 2. Launch Pi sessions from the control plane

- control plane creates worktree/workspace
- starts Pi in RPC/SDK or interactive mode
- registers run/session lifecycle itself

Best path for Symphony-like orchestration.

### 3. Hybrid managed + attachable

- control plane launches or owns the worker
- tmux/zellij exposes the worker for human attach
- Pi session files provide semantic replay/fork

Likely long-term ideal.

## Attach, replay, and fork model

There are several levels of "view or control a session" and they should not be confused:

1. **Live attach**
   - tmux/zellij attaches to the running TTY process.
   - Best for watching or manually steering an active session.

2. **Terminal preview**
   - `tmux capture-pane`/zellij equivalent shows recent terminal output.
   - Useful for cockpit previews, but not semantic enough for review/fork.

3. **Semantic replay**
   - read Pi session JSONL via `SessionManager` and render the conversation/tool timeline.
   - Best for review mode, summaries, and history browsing.

4. **Fork/resume**
   - use Pi session APIs/SDK to resume or fork from a saved session entry.
   - This is more trustworthy than trying to reconstruct state from terminal output.

5. **Runtime takeover / programmatic steering**
   - requires a Pi RPC/SDK-run session, or a connector protocol in the live Pi process.
   - Keyboard injection into tmux should be a fallback, not the primary orchestration API.

Design rule: tmux/zellij is excellent for attachment and preview, but Pi session files and SDK/RPC are the better layer for replay, fork, and orchestration.

## Near-term implementation sketch

```txt
packages/control-plane/
  src/daemon.ts
  src/types.ts
  src/store.ts
  src/server.ts
  src/reconcile.ts
  src/groups.ts

packages/tmux-cockpit/
  src/cli.ts
  src/ui.ts
  src/review.ts
  src/hints.ts
  src/tmux.ts

packages/web-access/src/
  control-plane-publisher.ts
  orchestrator-tools.ts
```

## References

Local research notes:

- `docs/research/pi-agent-control-plane/openai-harness-engineering-notes.md`
- `docs/research/pi-agent-control-plane/openai-symphony-blog-notes.md`
- `docs/research/pi-agent-control-plane/openai-symphony-spec-notes.md`
- `docs/research/pi-agent-control-plane/codex-app-features-notes.md`
- `docs/research/pi-agent-control-plane/odysseus0z-orchestration-notes.md`
- `docs/research/pi-agent-control-plane/source-urls.txt`

Primary public sources:

- OpenAI, “Harness engineering: leveraging Codex in an agent-first world”
- OpenAI, “An open-source spec for Codex orchestration: Symphony”
- `openai/symphony` spec and reference implementation notes
- Codex app docs on projects, worktrees, review, and parallel threads
- George / `@odysseus0z` notes on Linear/worker orchestration and overnight ticket throughput
