> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-06-23T00-36-48-785Z_019ef1e8-8811-7000-97aa-08741845cf4c/local/control-plane-dream-workstreams-plan.md

# Control-plane + Dream workstreams execution plan

## Context
Arthur asked to update the OMP/SymphonyX control-plane direction after learning about Elixir/OTP and OpenAI Symphony. The end state is documentation that explains the workstream split, keeps the core easy to test end-to-end, and does not prematurely hardwire the runtime: `control-plane-core` owns runtime orchestration state, while `dream-memory` owns delayed evidence-based learning and promotion. OMP collab is reused only as optional live attach/watch/steer transport; SQLite/ledger data remains the source of truth for runtime and task state.

Elixir/OTP explanation to capture in the docs: OTP means the Erlang/Elixir runtime patterns for long-running systems: supervised processes, process registries, message passing, restart policies, application lifecycle, tracing/introspection, and hot reload. It is attractive here because an agent orchestrator is mostly many stateful workers, queues, timers, crash/restart policy, status APIs, and live observability. OpenAI Symphony's reference implementation uses Elixir/Phoenix for exactly that shape, but its README says it is prototype software and recommends implementing a hardened version from `SPEC.md`, so the repo should use Symphony as a reference, not copy it blindly.

## Approach

### 1. Normalize the control-plane spec around two workstreams and a runtime-substrate checkpoint
Edit `docs/plans/pi-agent-control-plane.md`.

1. Replace the scope line near the top with this exact meaning:
   - `Scope: local control plane for managing Pi/OMP/Codex-like agent sessions. Two linked workstreams: \`control-plane-core\` (SQLite/event/session/task ledger plus runner API) and \`dream-memory\` (delayed evidence/promotion stream). Runtime substrate is chosen by a small vertical spike: reuse existing Rust/TS only if it stays simpler than an Elixir/OTP core. OMP collab is an optional \`live attach/watch/steer channel\`, never the source of truth.`
2. Insert a `## Collab reuse boundary` section immediately after the `Core idea` paragraph that says:
   - collab is useful for live attach to a running child agent, watching progress without owning the session, and steering/interruption within runner-native capability;
   - collab is not the source of truth, registry, database, durable transcript store, task queue, or learning store;
   - durable state lives in the repo-local SQLite/event/session/task ledger;
   - store only view links/evidence handles/credential references in the ledger by default, never full collab write links.
3. Insert a `## Runtime substrate checkpoint: Elixir/OTP vs Rust/TS` section before the old `## MVP` section or, if the old MVP section has already been replaced, before `## Workstreams / packets`.
4. The runtime-substrate section must state these decisions:
   - OTP is Elixir/Erlang's production pattern set for supervised concurrent systems: lightweight processes, message mailboxes, registries, supervisors, restart strategy, application lifecycle, tracing/introspection, and hot-code upgrade/reload support.
   - OpenAI Symphony's Elixir reference polls Linear, creates a workspace per issue, launches `codex app-server`, keeps Codex working until done/blocked, exposes Phoenix LiveView plus JSON API, and has `make all` plus optional live E2E tests.
   - OpenAI's Symphony README labels the Elixir implementation prototype software for evaluation and recommends implementing a hardened version from `SPEC.md`.
   - The repo should not make the TUI depend on Elixir. The boundary is JSON/SQLite/control API: Elixir may own orchestration; Rust may own TUI; TypeScript may own Pi extension/web/control-panel views.
   - The next implementation decision is a tiny vertical spike, not a rewrite. Build the smallest core that can run end-to-end and compare code/operational simplicity.
5. Define the exact spike acceptance in that section:
   - start two dry-run child runs from a local task list;
   - persist workflow/session/event rows;
   - expose `status --json` or `/api/state` with bounded previews;
   - mark one worker blocked and one done;
   - simulate one crashed worker and show restart or explicit failed state;
   - run one command that proves the whole path without a TUI.
6. Replace the existing `## MVP` section and `Phase 1` through `Phase 5` subsections with `## Workstreams / packets`.
7. Under `## Workstreams / packets`, create `### Workstream 1: \`control-plane-core\`` with owner paths:
   - `packages/symphony-lite-rs/**`
   - future `packages/symphony-lite-elixir/**` only if the spike is created
   - `packages/web-access/src/agent-cockpit*`
   - `docs/plans/pi-agent-control-plane.md`
   - `docs/plans/symphony-lite.md`
   - `docs/state/symphony-lite-direction.md`
8. Under `control-plane-core`, list these tasks exactly as the runtime plan:
   - maintain SQLite/ledger data as source of truth for workflow runs, subagent starts, events, external sessions, and task packet state;
   - run the Elixir/OTP vs Rust/TS vertical spike before committing to a runtime rewrite;
   - expose one stable JSON/CLI/API contract for central Pi orchestrator, Rust TUI, and future TypeScript web/control-panel clients;
   - support Pi RPC and Codex app-server runners;
   - keep tmux/Zellij materialization lazy/optional for human attach/debugging;
   - add task packet ledger (`task_packets`, `packet_ownership`, `packet_proofs`, `packet_events`) imported from `TASKS.md`;
   - expose deterministic commands/endpoints: `next`, `claim`, `paths`, `proof add`, `status`;
   - keep orchestrator Pi/OMP session as a client, not the authority.
9. Add `### Workstream 2: \`dream-memory\`` with owner paths:
   - future `docs/plans/dream-memory/**`
   - `data/dream-memory/**` or equivalent repo-local ledger
   - future runtime module/package only after promotion, not inside the first runtime spike
10. Under `dream-memory`, list these tasks exactly:
   - collect evidence in SQLite/ledger evidence/candidate/proposal tables or equivalent repo-local store;
   - require review before promoting any candidate to memory/docs/lints/skills;
   - materialize skills only after evidence and review, never from raw auto-generation;
   - keep this stream separate from `control-plane-core`; it consumes control-plane events but does not own them;
   - plan-level in `docs/state/symphony-lite-direction.md`; not currently implemented in the Rust package or Elixir spike.
11. Add `### Link between workstreams` immediately after both workstreams: `control-plane-core` produces durable workflow/subagent events; `dream-memory` may read those events as evidence, but promotion decisions write reviewed repo artifacts, not runtime state. Runtime state remains in the control-plane ledger; learning candidates remain in the Dream ledger.
12. In the existing `## Elixir / Symphony adoption notes`, replace any recommendation that says not to start with Elixir with this decision: `Do a bounded Elixir/OTP vertical spike before a rewrite. If the Elixir spike satisfies the acceptance checklist with less glue and clearer supervision than the existing Rust/TS path, promote Elixir to the orchestration core while keeping Rust TUI and TypeScript/Pi/web clients behind JSON/SQLite/API boundaries. If not, keep Rust/TS and copy only Symphony's architecture.`
13. Keep existing open questions and vendor/research notes after the new workstream section. Do not leave `Phase 1`, `Phase 2`, `Phase 3`, `Phase 4`, or `Phase 5` headings in this file.

### 2. Convert Symphony Lite planning lanes into packets under the two workstreams
Edit `docs/plans/symphony-lite.md`.

1. Rename `## Implementation lanes` to `## Workstreams / packets`.
2. Replace `Lane A` through `Lane E` headings with packets under `### Workstream 1: \`control-plane-core\``:
   - `#### Packet A — Dynamic workflow v2`
   - `#### Packet B — Runtime substrate spike / central orchestrator API`
   - `#### Packet C — Cockpit/tmux session control`
   - `#### Packet D — Ask Arthur / human-in-loop`
   - `#### Packet E — Reviewer personas and tool profiles`
3. Preserve each packet's existing owner paths and task bullets from the old lanes, but for Packet B add `future packages/symphony-lite-elixir/** if the spike is implemented` below `packages/symphony-lite-rs/**`.
4. Under Packet B, replace `create Rust SQLite-backed runner/TUI/server skeleton` with `compare the existing Rust SQLite runner/TUI path against a minimal Elixir/OTP orchestrator spike using the acceptance checklist in \`docs/plans/pi-agent-control-plane.md\``.
5. Under Packet B, keep these task bullets from the old lane:
   - control child Pi agents through `pi --mode rpc` by default;
   - support Codex child agents through `codex app-server --listen stdio://`;
   - expose one stable `symphony_lite`/`symphonyx` API for central Pi orchestrator, TUI, and future GUI;
   - make SQLite/ledger state the source of truth for important state/events; keep sidecar logs opt-in/debug-only;
   - keep tmux materialization lazy/optional for human attach/debugging;
   - implement k9s/lazydocker-style resource views over workflows, subagents, questions, artifacts, and events.
6. Add one sentence after Packet B tasks: `If Elixir wins the spike, it owns orchestration/supervision only; Rust TUI and TypeScript/Pi/web clients remain clients of the same JSON/SQLite/API contract.`
7. Replace `Lane F` and `Lane G` headings with packets under `### Workstream 2: \`dream-memory\``:
   - `#### Packet F — Lopopolo/Codex/Symphony corpus`
   - `#### Packet G — Model/cost benchmark for subagents`
8. Add one lead sentence under `control-plane-core`: `Durable local control plane and orchestration surface. SQLite/ledger data is the source of truth for workflow runs, subagent starts, events, external sessions, task packets, and human-in-loop questions.`
9. Add one lead sentence under `dream-memory`: `Delayed evidence/promotion stream. Skills, docs, lints, and memory are materialized only after evidence and review.`
10. Replace `## Near-term priority order` with `## Active / next packets`. The ordered list must be:
   1. `Packet B` (`control-plane-core`): run the runtime substrate spike; choose Elixir/OTP core only if it produces the same end-to-end orchestration with less glue and clearer supervision than Rust/TS.
   2. `Packet A` (`control-plane-core`): add minimal persisted workflow/run record and child artifact format to the chosen runtime contract.
   3. `Packet D` (`control-plane-core`): define `ask_arthur` schema + queue so agents can request input cleanly.
   4. `Packet E` (`control-plane-core`): add reviewer personas + tool profiles.
   5. `Packet C` (`control-plane-core`): add tmux/cockpit child-session spawning for long-lived agents.
   6. `Packet F` (`dream-memory`): archive high-signal Lopopolo/Codex/Symphony sources as evidence for later promotion.
   7. `Packet G` (`dream-memory`): start model/cost benchmarks as evidence for promotion decisions.
   8. Add true `fork-current` context only after persisted runs/tool profiles are stable.
11. Leave `Tool profiles v0`, `Persona lenses v0`, `Orchestrator herding loop`, and `Open questions` intact except for terminology needed by the steps above.

### 3. Update living direction and communication guidance
Edit `docs/state/symphony-lite-direction.md`.

1. Replace the `Cross-agent communication should stay simple...` desired primitive with a three-tier rule:
   - built-in OMP `irc` is for live same-process subagents;
   - OMP collab is for optional encrypted live attach/watch/steer across sessions;
   - durable coordination is source-of-truth doc/SQLite updates, with concise notes only when ownership or scope changed.
   The paragraph must explicitly say not to rebuild agent chat, per-agent inboxes, message queues, cursors, or custom broker semantics unless a concrete workflow proves they are needed.
2. Replace `central_orchestrator` wording so it does not say `while the Rust service owns...`. Use: `central_orchestrator: the human-facing Pi/LLM session that decides, steers, and synthesizes through one Symphony Lite API, while the chosen runtime service owns durable state and child process lifecycle.`
3. Replace the 2026-06-08 implementation direction paragraph that says Rust is the fit with this exact decision:
   - `Implementation direction as of 2026-06-23: the runtime boundary is JSON/SQLite/API first. The existing Rust package remains the working prototype, but the next core step is a bounded Elixir/OTP spike because OpenAI Symphony's reference implementation maps agent orchestration to OTP supervision, process registries, restart policy, and Phoenix observability. Elixir may own orchestration if it proves simpler end-to-end; Rust remains a good TUI/client layer and TypeScript remains the Pi extension/web/control-panel layer.`
4. Insert a `### 2026-06-23` care-log entry before the existing `### 2026-06-08` entry. It must state:
   - Arthur split the effort into `control-plane-core` and `dream-memory`;
   - Arthur wants Elixir/OTP considered seriously for the orchestrator because OTP supervision and Phoenix observability may remove infrastructure code;
   - `control-plane-core` owns local SQLite/session/event/task ledger, runtime registry, child runner handles, and cockpit/SymphonyX APIs;
   - `dream-memory` consumes completed sessions/events as evidence, scores repeated patterns, stages candidates, and materializes memory/docs/lints/skills only after review;
   - skills are derived artifacts, not the memory database;
   - OMP collab is optional live attach/watch/steer transport, not a registry, queue, or source of truth.
5. In the existing 2026-06-08 care log, replace `Implemented first SymphonyX Rust slice` with `Implemented first SymphonyX Rust iteration`. No other behavior claim changes.

### 4. Update the Rust package README terminology without pretending Rust is final
Edit `packages/symphony-lite-rs/README.md`.

1. After the opening description, add a `Planning docs:` list with links to:
   - `../../docs/plans/symphony-lite.md` — architecture and workstreams
   - `../../docs/state/symphony-lite-direction.md` — living direction and care log
   - `../../docs/plans/pi-agent-control-plane.md` — control-plane/core planning
2. Rename `## Current v0` to `## Current capabilities`.
3. Add one sentence after the current capabilities list: `This package is the current working prototype, not a final runtime commitment; the control-plane contract must remain portable to a possible Elixir/OTP orchestration core.`
4. Replace the `Not yet implemented:` list with `## Upcoming workstreams` containing exactly two bullets:
   - `control-plane-core`: runtime substrate spike (existing Rust/TS path vs minimal Elixir/OTP orchestrator); richer ratatui actions/detail panes beyond the current read-only dashboard; Unix-socket/control API server; long-lived child continuation/steering after `run`; worktree isolation; Pi extension tool bridge; long-lived Codex app-server steer/interrupt/fork controls; reliable arbitrary live Pi-session discovery via heartbeat/cockpit plugin bridge
   - `dream-memory`: delayed evidence/promotion stream for Dream/auto-learn (plan-level; not currently implemented in this package)
5. Do not change build/test commands or runtime layout.

### 5. Add the top-level task tracker entry
Edit `TASKS.md` only after the four docs above are aligned.

1. If a row with ID `T-2026-06-23-001` already exists, update only its notes.
2. If it does not exist, add this row under `## Active` after the existing active task rows:
   - ID: `T-2026-06-23-001`
   - Task: `Build OMP/SymphonyX control-plane and Dream promotion workstreams`
   - Owner: `Codex`
   - Notes: `Docs: \`docs/plans/pi-agent-control-plane.md\`, \`docs/plans/symphony-lite.md\`, \`docs/state/symphony-lite-direction.md\`, \`packages/symphony-lite-rs/README.md\`. Split: \`control-plane-core\` owns runtime/task/session state and attach handles; first packet is a Rust/TS vs Elixir/OTP substrate spike behind a stable JSON/SQLite/API contract. \`dream-memory\` owns delayed evidence/candidate/proposal promotion to memory/docs/lints/skills after review. OMP collab is optional live attach/watch/steer transport, not source of truth.`
3. Do not move unrelated tasks or rewrite long Jimeng status notes.

## Critical files & anchors
- `docs/plans/pi-agent-control-plane.md`: top scope/core idea, `## Elixir / Symphony adoption notes`, and old MVP section around `## MVP`; this is the authoritative control-plane spec that must define the workstream split, collab boundary, and Elixir/OTP spike acceptance.
- `docs/plans/symphony-lite.md`: `## Implementation lanes` and `## Near-term priority order`; these must become workstreams/packets without dropping existing owner paths.
- `docs/state/symphony-lite-direction.md`: `## Desired primitives`, `## UI / monitoring direction`, and `## Care log`; this stores durable direction and must replace Rust-final wording with runtime-contract-first wording.
- `packages/symphony-lite-rs/README.md`: opening status sections; this must reflect current capabilities while making clear the Rust package is the current prototype, not a final runtime commitment.
- `TASKS.md`: `## Active` table; this is the top-level discoverability hook for future sessions.

## Verification
Run these read/search checks from repo root after editing; no build/typecheck/lint is required because the change is documentation-only.

1. Confirm stale sequential headings are gone from the touched planning sections:
   - Use `search` for `Phase 1:|Phase 2:|Phase 3:|Phase 4:|Phase 5:|## Implementation lanes|## Near-term priority order|Implemented first SymphonyX Rust slice` in `docs/plans/pi-agent-control-plane.md`, `docs/plans/symphony-lite.md`, `docs/state/symphony-lite-direction.md`, and `packages/symphony-lite-rs/README.md`.
   - Expected: no matches.
2. Confirm the new workstream and runtime-substrate vocabulary is present:
   - Use `search` for `control-plane-core|dream-memory|live attach/watch/steer channel|Elixir/OTP|runtime substrate spike` in the same four files.
   - Expected: matches in `docs/plans/pi-agent-control-plane.md`, `docs/plans/symphony-lite.md`, `docs/state/symphony-lite-direction.md`, and `packages/symphony-lite-rs/README.md`.
3. Confirm Rust-final wording is gone from durable direction:
   - Use `search` for `Rust service owns|Rust local runner/TUI/server is a good fit|do not adopt the Elixir runtime as a direct dependency|Why not start with Elixir here` in `docs/state/symphony-lite-direction.md` and `docs/plans/pi-agent-control-plane.md`.
   - Expected: no matches.
4. Confirm the top-level tracker row exists:
   - Read `TASKS.md:7-25`.
   - Expected: row ID `T-2026-06-23-001` appears under `## Active` with notes pointing to the four updated docs and the Elixir/OTP substrate spike.
5. Confirm the README still gives the Rust smoke command unchanged:
   - Read `packages/symphony-lite-rs/README.md:29-45`.
   - Expected: `cargo test --manifest-path packages/symphony-lite-rs/Cargo.toml` remains under `## Build/test`.

## Assumptions & contingencies
- If some target wording already exists when implementation starts, keep it and only fill missing pieces; do not duplicate sections.
- If `TASKS.md` already has a different active control-plane/Dream task, do not create a second row; change that row's ID to `T-2026-06-23-001` only if it is clearly the same task, otherwise add the specified row.
- If the Elixir/Phoenix toolchain is not installed during a later code spike, do not install it as part of this documentation update; record the install command in the future spike plan instead.
- If a search finds `slice` outside the specified stale phrase `Implemented first SymphonyX Rust slice`, leave it unless it is in the edited sections and clearly refers to the old sequential implementation model.
- If a file has unrelated user edits around the same section, preserve the user text and apply the smallest local wording change that produces the specified final headings and bullets.
