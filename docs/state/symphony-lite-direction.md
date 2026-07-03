# Symphony Lite Direction State

Living direction for the meta-harness Arthur wants to use to build everything else.

## Distinction

Slotok is the product/app direction: a Cursor/Zed-like workbench for TikTok/AI-video/UGC generation, decomposition, evals, DAGs, artifacts, and infinite remix loops.

Symphony Lite is the meta-workflow/orchestration system used to build Slotok and other projects: programmatic agent fan-out, forked context, reviewer personas, constrained tool sets, workflow DAGs, monitoring, and synthesis.

Naming as of 2026-06-08: use **SymphonyX** as the concrete tool/binary codename (`symphonyx`), while **Symphony Lite** remains the descriptive architecture/pattern name.

Do not collapse these into one concept. Slotok may later use Symphony Lite internally, but Symphony Lite is the agent-harness layer.

## North star

Build a small, inspectable, local-first agent orchestration harness where an orchestrator can:

- fork or spawn subagents from a shared checkpoint
- assign roles/personas and constrained tool sets
- run small parallel DAGs of work
- monitor progress, transcripts, artifacts, and failures
- attach to long-running sessions when useful
- synthesize/review outputs without dumping every child transcript into parent context
- let subagents contact Arthur for clarification, approval, creative judgment, or budget/taste decisions through a structured human-in-loop queue
- use cheaper/weaker models for narrow tasks when quality is enough

## Lopopolo-style principles to distill

- Fewer overlapping tools. Prefer one blessed way to do a task over five equivalent tools.
- Tool sets should be role-scoped: reviewers often need read/search/test, not edit/write; implementers need edit/write; browser/provider tools should be explicit.
- The durable artifact is the harness: docs, tests, guardrails, prompts, schemas, evals, logs, and review loops, not just code diffs.
- Use reviewer personas as lenses, not generic second opinions: docs drift, reliability, security/secrets/quota, UX/output quality, agent-legibility, cost/latency, creative direction.
- Agents should have source-of-truth docs and mechanical checks, not vague reminders.
- Prefer TypeScript/Bun/SQLite/JSON-first paths in this repo unless a specific subsystem has a better reason.
- Benchmark cheaper/smaller/subscription-backed models for subagent lanes instead of assuming premium API calls are always needed.

## Desired primitives

- `workflow_run`: durable record with script/recipe, parent session/checkpoint, status, cost, and artifacts.
- `subagent`: role, persona, model, tool profile, context mode, session file/transcript, tmux pane, status.
- `subagent_start`: starting a subagent must first create a durable row/event with intended context/tool/profile/session/worktree/attach semantics before any process/model call begins.
- `tool_profile`: named allowlist/denylist such as `reviewer-readonly`, `implementer-ts`, `browser-research`, `provider-eval`, `no-network`.
- `persona`: prompt lens plus success/failure criteria.
- `artifact`: markdown, JSON, patch, screenshot, logs, eval result, or generated media.
- `synthesis`: final compact result that references artifacts instead of inlining everything.
- Cross-agent communication stays simple and three-tiered: built-in OMP `irc` is for live same-process subagents; OMP collab is for optional encrypted live attach/watch/steer across sessions; durable coordination is source-of-truth doc/SQLite updates, with concise notes only when ownership or scope changed. Do not rebuild agent chat, per-agent inboxes, message queues, cursors, or custom broker semantics unless a concrete workflow proves they are needed.
- `ask_human` / `ask_arthur`: structured questions from subagents with urgency, options, recommendation, default behavior, and persisted answers.
- `central_orchestrator`: the human-facing Pi/LLM session that decides, steers, and synthesizes through one Symphony Lite API, while the chosen runtime service owns durable state and child process lifecycle.

## Context modes

- `prompt-only`: current dynamic-workflows behavior; subagent only gets task prompt and cwd.
- `summary`: pass a compact handoff summary and key paths.
- `fork-current`: create a persisted Pi/Codex session fork from a checkpoint.
- `worktree`: run in an isolated git worktree for code-changing children.
- `attached`: long-lived tmux/Zellij process with cockpit metadata for monitoring.

## UI / monitoring direction

Symphony Lite should expose enough state for a future GUI/workbench:

- workflow list
- human-input inbox for pending agent questions
- DAG of subagents/tasks
- per-agent transcript/session links
- tmux attach commands
- artifacts and diffs
- reviewer verdicts
- model/tool/cost metrics
- rerun/resume/kill controls

Use `agent_cockpit` as the current local session registry where possible.

Implementation direction as of 2026-06-23: the runtime boundary is JSON/SQLite/API first. The existing Rust package remains the working prototype, but the next core step is a bounded Elixir/OTP spike because OpenAI Symphony's reference implementation maps agent orchestration to OTP supervision, process registries, restart policy, and Phoenix observability. Elixir may own orchestration if it proves simpler end-to-end; Rust remains a good TUI/client layer and TypeScript remains the Pi extension/web/control-panel layer.

The API should be AI-first and shared by humans and agents: same nouns/actions through the SymphonyX CLI/JSON API first, with TUI and future GUI as clients. Pi agents should normally use the CLI via a skill; do not create parallel Pi tools for every command until there is clear friction. Agents should get stable JSON envelopes, bounded previews, handles/IDs, append-only events, and idempotent/scriptable commands so a central Pi orchestrator can recover after compaction by calling `status` rather than remembering everything.

SymphonyX should show both SymphonyX-owned child agents and external local agent sessions. Use SQLite `external_sessions` as the index for discovered non-SymphonyX sessions. Historical Codex sessions can be scanned from `~/.codex/sessions/**/*.jsonl` without a plugin. Historical Pi sessions can be added by scanning Pi session files. Arbitrary currently-running Pi sessions that SymphonyX did not launch need a heartbeat/cockpit-style Pi extension or publisher for reliable liveness; file scans alone should be treated as recent/historical, not authoritative running status.

SymphonyX should behave like a repo-local singleton daemon, similar in spirit to tmux: one background service per project/runtime root owns child process lifecycle and writes SQLite as the source of truth; foreground TUI/watch commands attach to it; AI agents poll/control it via JSON CLI/API. JSONL/stdout/stderr sidecars are opt-in debug/export artifacts, not the normal monitoring path. Search can start with SQLite events plus `symphonyx search --json`, with optional SQLite FTS later only if needed.

## Care log

### 2026-06-23

Arthur split the effort into `control-plane-core` and `dream-memory`. He decided to try Elixir/OTP seriously for the orchestrator because OTP supervision, process isolation, restart policy, and built-in observability directly map to the reliability/retries/concurrency problems an agent harness faces, and may remove a lot of infrastructure code that Rust/TS would have to grow by hand. The bounded spike package is `packages/symphony-lite-elixir`; use `mise exec erlang@28.5 elixir@1.20.1-otp-28 -- ...` for Erlang/Elixir installs and commands, and use the `symphony-elixir-test`, `symphony-elixir-build`, and `symphony-elixir-spike` mise tasks for verification. `control-plane-core` owns the local SQLite/session/event/task ledger, runtime registry, child runner handles, and cockpit/SymphonyX APIs. Local files and `TASKS.md` are first-class task sources through adapters, not second-class fallbacks behind Linear or GitHub. `dream-memory` consumes completed sessions/events as evidence, scores repeated patterns, stages candidates, and materializes memory/docs/lints/skills only after review; skills are derived artifacts, not the memory database. OMP collab is optional live attach/watch/steer transport, not a registry, queue, or source of truth. The overarching durable goal for this workstream is now captured in `docs/plans/symphony-lite-goal.md`.

### 2026-06-08

Arthur clarified that Symphony Lite is separate from Slotok. Slotok is the video/remix product; Symphony Lite is the meta-agent orchestration/harness used to build and improve everything. High-signal source material includes Ryan Lopopolo's public harness-engineering writing, Latent Space interview, Twitter/X posts and quote-tweets, OpenAI Codex/Symphony/auto-review materials, and the Codex GUI plugin/workflow surface.

Implemented first SymphonyX Rust iteration under `packages/symphony-lite-rs`: SQLite schema, status/events/search/ask commands, text `watch`, ratatui/crossterm `tui` with vim-like navigation and daemon autostart, daemon stub, Pi RPC one-shot runner, Codex app-server one-shot runner, stable JSON envelopes, SQLite-first structured event storage, opt-in `--file-logs` sidecars, final-message preview, and `insta` snapshots for JSON/event shapes.

Arthur clarified during Slotok planning that durable workflow semantics are required even for starting subagents. A separate Pi agent in tmux pane `%5` left a coordination note at `data/coordination/slotok-symphony-durable-workflows-handoff.md` for the SymphonyX implementation agent in pane `%1`: current in-memory dynamic-workflow fan-out is useful but insufficient; workflow runs and subagent starts need durable IDs, context-mode semantics, attach/resume handles, artifacts, and review/synthesis handles.

Arthur rejected the agent-message/inbox/event-log design as overcomplicated for little gain. Current protocol: when one agent edits another agent's/shared scope, edit the source-of-truth file directly and append a short note to `docs/coordination/agent-edit-log.md` explaining who changed what and why. Git diff/log plus the coordination log is enough for now.

Added external session indexing: `symphonyx sync` scans local Codex JSONL history and stores rows in SQLite `external_sessions`; `status --json` exposes `sessions`; `watch`/`tui` auto-sync before rendering; TUI gained a `s` Sessions tab. Decision: Pi does not need a plugin for historical session indexing, but reliable live-state for arbitrary Pi sessions not launched by SymphonyX should come from a heartbeat/cockpit-style plugin/publisher.
