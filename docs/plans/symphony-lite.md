# Symphony Lite plan

Symphony Lite is the repo-local meta-harness for orchestrating agents while building Slotok and the rest of this project.

It is separate from Slotok:

- **Slotok**: the AI video/TikTok/UGC remix workbench/product.
- **Symphony Lite**: the agent workflow/orchestration layer we use to build, review, and steer work.

## Why this exists

We want an orchestrator agent that can fan out work, monitor subagents, gather artifacts, and synthesize results without turning the parent chat into an unreadable mega-transcript.

This should distill useful public harness-engineering ideas from Ryan Lopopolo/OpenAI Codex/Symphony/Auto-review into a small local-first version that fits our budget, repo, tools, and taste.

## Core principles

1. **One blessed way when possible.** Avoid giving agents five overlapping tools or languages for the same task. Prefer TypeScript/Bun/SQLite/JSON-first paths unless a lane has a specific reason not to.
2. **Role-scoped tools.** Reviewers should usually be read-only; implementers can edit; provider/browser lanes get explicit extra tools.
3. **Fork from a known checkpoint.** Subagents should be traceable to a parent prompt/session/checkpoint.
4. **Artifacts over transcript spam.** Store full child transcripts/logs/artifacts externally; parent sees compact verdicts and links.
5. **Human input is a first-class dependency.** Agents need a way to ask Arthur for clarification, approval, creative judgment, budget decisions, or taste calls without blocking invisibly.
6. **Reviewer personas are lenses.** Use focused reviewers for docs drift, security/quota, reliability, agent-legibility, UX/output, cost/latency, and creative direction.
7. **Cheap lanes are allowed.** Benchmark smaller/subscription-backed models for narrow subagent roles instead of defaulting to expensive frontier API calls.

## Human contact / Ask Arthur primitive

We need a standardized `ask_human` / `ask_arthur` primitive for orchestrated agents.

Initial requirements:

- agent can raise a structured question with urgency, options, default recommendation, and blocking/non-blocking status
- question is persisted to the workflow/run record
- orchestrator can batch non-urgent questions instead of interrupting constantly
- UI can show pending questions across all subagents
- answer becomes an artifact/event and is injected back into the relevant agent/workflow context
- support timeout/default behavior for non-critical decisions

Candidate schema:

```json
{
  "id": "ask_...",
  "workflow_id": "wf_...",
  "agent_id": "agent_...",
  "severity": "blocking|soon|FYI",
  "question": "string",
  "context": "string",
  "options": ["string"],
  "recommended_option": "string",
  "default_if_no_answer": "string",
  "needed_by": "string|null",
  "status": "open|answered|timed_out|cancelled"
}
```

Possible transports, in order:

1. Pi TUI prompt/notification when orchestrator is active.
2. Workbench UI inbox for pending questions.
3. Terminal/tmux notification line for attached sessions.
4. Optional later: macOS notification, email/Gmail, or phone push for long-running farm tasks.

## Tool profiles v0

| Profile | Tools | Use |
|---|---|---|
| `reviewer-readonly` | read/search/diff/test commands, no edits | docs/security/reliability/UX review |
| `implementer-ts` | read/edit/write/bash/typecheck/test | TypeScript implementation lanes |
| `research-web` | web search/fetch/source archive, no code edits by default | public-source research |
| `browser-cdp` | background browser/CDP only | frontend/provider/API inspection |
| `provider-eval` | provider APIs with cache/log/spend caps | video/image/model benchmarks |
| `coordinator` | cockpit/session/status tools, limited edits to plans/status docs | orchestration and synthesis |

## Persona lenses v0

- **Docs drift reviewer** — checks whether source-of-truth docs changed with behavior.
- **Security/quota reviewer** — secrets, cookies, paid APIs, browser permissions, destructive commands.
- **Reliability reviewer** — retries, timeouts, cleanup, resumability, failure visibility.
- **Agent-legibility reviewer** — can future agents discover commands, docs, schemas, and proof paths?
- **UX/output reviewer** — is the final answer or UI understandable and fast to inspect?
- **Cost/latency reviewer** — spend, cache hits, token usage, throughput, cheaper model alternatives.
- **Creative direction reviewer** — checks Slotok/video work against the taste ledger instead of generic tags.
- **Rubber Duck / Adversarial Friend** — cross-cutting sharp-but-friendly critic for anything that warrants pushback: architecture, code, research, creative direction, final answers, cost/model choices, product/workflow decisions. It should not invent objections when things are fine. Prompt: `docs/review-agents/rubber-duck-adversarial.md`.

## Runtime design docs

- [`symphony-lite-goal.md`](./symphony-lite-goal.md) — overarching durable goal and non-negotiable boundaries for the control-plane-core workstream.
- [`symphony-lite-rust-runner.md`](./symphony-lite-rust-runner.md) — proposed Rust SQLite/TUI/server runtime, Pi RPC child-agent runner, central Pi orchestrator API, and k9s/lazydocker-inspired TUI shape.

The centralized task metadata ledger from T-2026-06-13-005 is part of Packet B/control-plane-core. It should reuse the selected Symphony Lite ledger seam and the existing cockpit SQLite/runtime model; it is not a separate database workbench package.

## Workstreams / packets

### Workstream 1: `control-plane-core`

Durable local control plane and orchestration surface. SQLite/ledger data is the source of truth for workflow runs, subagent starts, events, external sessions, task packets, and human-in-loop questions.

#### Packet A — Dynamic workflow v2

Owner paths:

- `packages/dynamic-workflows/**`
- future `packages/symphony-lite/**`

Tasks:

- switch active Pi package to local vendored workflow when ready
- persist workflow run records
- add agent options: `persona`, `toolProfile`, `context`, `persist`, `attach`, `worktree`
- implement context modes: `prompt-only`, `summary`, `fork-current`
- record child artifacts/transcripts instead of only final strings

#### Packet B — Runtime substrate spike / central orchestrator API

Owner paths:

- `packages/symphony-lite-rs/**`
- `packages/symphony-lite-elixir/**`
- `docs/plans/symphony-lite-rust-runner.md`
Tasks:

- implement an Elixir/OTP substrate spike using local-file/TASKS.md task sources, SQLite ledger, JSON CLI/API, and dry-run/Pi/OMP runner boundaries; compare against the existing Rust SQLite runner/TUI path using the acceptance checklist in `docs/plans/pi-agent-control-plane.md`
- control child Pi agents through `pi --mode rpc` by default
- support Codex child agents through `codex app-server --listen stdio://`
- expose one stable `symphony_lite`/`symphonyx` API for central Pi orchestrator, TUI, and future GUI
- make SQLite/ledger state the source of truth for important state/events; keep sidecar logs opt-in/debug-only
- keep tmux materialization lazy/optional for human attach/debugging
- implement k9s/lazydocker-style resource views over workflows, subagents, questions, artifacts, and events

If Elixir wins the spike, it owns orchestration/supervision only; Rust TUI and TypeScript/Pi/web clients remain clients of the same JSON/SQLite/API contract.

#### Packet C — Cockpit/tmux session control

Owner paths:

- `packages/web-access/src/agent-cockpit*`
- future `packages/symphony-lite/src/tmux-*`

Tasks:

- spawn named tmux/Zellij child sessions with seeded prompts
- publish heartbeat/session metadata to cockpit
- expose attach commands and transcript/session paths
- support kill/resume/status

#### Packet D — Ask Arthur / human-in-loop

Owner paths:

- future `packages/symphony-lite/src/ask-human*`
- future workbench inbox UI

Tasks:

- define ask schema and SQLite/event storage
- add Pi TUI prompt path for blocking questions
- add non-blocking question queue
- add timeout/default behavior

#### Packet E — Reviewer personas and tool profiles

Owner paths:

- `docs/review-agents/**` or `packages/dynamic-workflows/prompts/**`
- future `packages/symphony-lite/src/tool-profiles.ts`

Tasks:

- write persona prompts, starting from `docs/review-agents/rubber-duck-adversarial.md`
- map personas to tool profiles
- add a standard review workflow for diffs/plans
- test on one real change

### Workstream 2: `dream-memory`

Delayed evidence/promotion stream. Skills, docs, lints, and memory are materialized only after evidence and review.

#### Packet F — Lopopolo/Codex/Symphony corpus

Owner paths:

- `docs/research/lopopolo-agent-material/**`
- `docs/research/openai-codex-symphony/**` if created

Tasks:

- archive missing high-signal X/Twitter posts and quote tweets
- inspect `openai/codex` and `openai/symphony`
- distill plugin/workflow/persona/permission patterns
- feed concrete implementation ideas into `control-plane-core` or candidate memory

#### Packet G — Model/cost benchmark for subagents

Owner paths:

- future benchmark scripts/docs under `docs/research/` and `scripts/`

Tasks:

- benchmark smaller/cheaper models on reviewer lanes
- compare subscription-backed Codex/Pi vs direct API cost/quality where measurable
- record latency, cost, pass/fail quality, and fit by persona/tool profile
- use results as evidence for `dream-memory` promotion decisions

## Orchestrator herding loop

The orchestrator should be able to run a lightweight loop across active subagents/workflows:

1. **Inspect** — list cockpit/workflow records, tmux/Zellij panes, child session files, recent events, and artifact status.
2. **Classify** — mark agents as running, blocked, stale, done, failed, or needs-Arthur.
3. **Nudge** — send a focused next instruction to stuck/idle agents, or queue an `ask_arthur` question if judgment/approval is needed.
4. **Collect** — pull final artifacts, diffs, logs, screenshots, evals, and transcript pointers into the workflow record.
5. **Synthesize** — summarize what happened, identify conflicts between children, and propose the next batch.
6. **Prune** — kill/restart stale workers and avoid letting zombie sessions accumulate.

Current limitation: in-memory `workflow` subagents cannot be attached/resumed after completion; only their returned result is available. Real herding requires persisted child sessions or tmux/Zellij/Codex/Pi workers registered in cockpit.

## Active / next packets

These are the current priority packets across workstreams. Status moves in `TASKS.md` during the transition and in the SQLite task metadata ledger once the first import/claim/proof slice is live.

1. **Packet B** (`control-plane-core`): implement the Elixir/OTP substrate spike as the primary path, starting with the centralized task metadata ledger (`task_packets`, `packet_ownership`, `packet_proofs`, `packet_events`), local `TASKS.md` import, packet-ledger source pointers, JSON CLI/API commands, and dry-run/Pi/OMP runner boundaries; keep the Rust/TS path as the comparison baseline only if the spike does not satisfy the acceptance checklist.
2. **Packet A** (`control-plane-core`): add minimal persisted workflow/run record and child artifact format to the same runtime contract.
3. **Packet D** (`control-plane-core`): define `ask_arthur` schema + queue so agents can request input cleanly.
4. **Packet E** (`control-plane-core`): add reviewer personas + tool profiles.
5. **Packet C** (`control-plane-core`): add tmux/cockpit child-session spawning for long-lived agents.
6. **Packet F** (`dream-memory`): archive high-signal Lopopolo/Codex/Symphony sources as evidence for later promotion.
7. **Packet G** (`dream-memory`): start model/cost benchmarks as evidence for promotion decisions.
8. Add true `fork-current` context only after persisted runs/tool profiles are stable.

## Open questions

- Should the first persisted store live inside `packages/dynamic-workflows`, `packages/symphony-lite`, or the future pipeline orchestrator?
- Should child Pi sessions be spawned through Pi CLI JSON mode first, or through SDK/session APIs?
- Which questions should interrupt Arthur immediately vs queue for batch review?
- How much parent context should `fork-current` include by default?
- How do we safely route paid/provider/browser tools to only agents that need them?
