# Thread garden — federated control plane and harness UX — 2026-07-22

> **Source session:** `019f7869-d126-7000-8823-f9a60934fa11`
> **Covered range:** 2026-07-19 start through Arthur's 2026-07-22 lifecycle-command correction.
> **Method:** parent-owned synthesis; read-only transcript archaeology `RecoverForkCommandDesign`; repo/config/tool evidence outranked prose.

## Current authorities updated/created

- `docs/fable/federated-control-plane.md` — canonical/receipt/projection/cache, machine roles, control-plane/resource design, workspace/package/URI/mise/review model, Today/Next/Deferred.
- `docs/fable/harness-research-register.md` — deferred/research/watchlist with evidence and promotion triggers.
- `docs/fable/context-bearing-delegation.md` — cheap-worker/expensive-parent retrieval and escalation doctrine.
- `docs/fable/session-lifecycle-commands.md` — recovered `/continue`/`/fork`/`/tangent`/`/converge`/`/commission` semantics.
- `docs/fable/friction-triage-contract.md` — report evidence/disposition/recurrence contract.
- `docs/fable/omp-runtime-map.md` — derived code/monitoring map.
- `skills/core/thread-garden/SKILL.md` — explicit human-controlled thread integration routine.
- `docs/state/agent-tooling-preferences.md` — concise engineering-manager mode and explicit thread-garden habit.
- `docs/fable/atlas.md` — current locator links.

Historical/supporting docs gardened: `catalog/workspaces.yml`, `docs/fable/shared-workspace-brief.md`, `docs/plans/pi-agent-control-plane.md`, `streams/harness/attention-control-plane.md`, `packages/control-plane/README.md`, `docs/fable/harness-slimming.md`.

## Settled decisions

- Canonical state stays owner-local; receipts are immutable evidence; global wiki/review/status are derived projections; caches are disposable.
- Mac is cockpit; large CPU/RAM server is complete OMP/control execution host; Ubuntu remains GPU/graphical-browser worker. No shared mutable mounted filesystem.
- One control-plane app may expose inbox/tasks/workspaces/wiki/sessions/traces/artifacts/services as projections over typed resources.
- One accountable owner, many contributors; model/agent identity is run provenance. Correlate session↔agent run↔jj change↔Git commit through receipts; exact Git author/coauthor mapping remains open.
- Full internal IDs plus stable collision-checked short aliases; shorter unique prefixes are input UX.
- Workspace/package discovery is distinct from package publication/distribution.
- Main chat stays terse: decision, material risk, next action; details go to reviewable files.
- High-signal deferred design gets a linked design note, not only a compressed register row.

## Lifecycle correction recovered

Primary testimony: session `019f77c0-6bbe-7000-a700-6b07c1e41136`, messages `958c17f6`, `072e7465`, `ac53843d`, `5bc721cc`, `18781384`, `527e9d34`; later correction in this source session messages `c967a7d6`, `e1a66ee3`.

- cmux workspace = durable workstream; sessions are tabs/surfaces inside its OMP pane.
- `/continue` = linear fresh-context top-level successor from bounded handoff + goal/pointers; not `omp --fork`/copied transcript.
- `/fork` = parallel same-problem branch from explicit source session/entry; source stays live.
- `/tangent` = distinct concern/substream.
- `/converge` = explicit synthesis artifact + one successor, then health-gated source park.
- `/commission` = visible autonomous scoped child while parent remains synchronous.
- `task` = hidden/in-process worker.

The accidental successor `019f8846-84f6-7353-a52d-112c49bd56cc` and accidental new workspace were rejected evidence, not implementation. HR-205/212/218/219 now point to the design authority.

## Implemented/blessed harness fixes

Blessed no-rollout candidate: `16.0.1+fork.b3324b9fbb56`, digest `c4244f79…`; explicit restart required.

- HR-235 Ctrl+O complete textual tool args.
- HR-236 starting/failed/stale child lifecycle truth before history/HUD/shutdown.
- HR-241 provider-anchored `/context` matches statusline; retained-text estimates labeled separately.
- HR-242 full wide tool-header paths and deterministic narrow middle elision.
- HR-233 first bounded decoded history search/record query slice; composable decoded virtual/materialized file remains requested.

Proof: 171 focused tests, 0 failed; coding-agent typecheck and changed-file Biome check clean.

## Backlog/research/error integration

Actionable HR-233–244 now cover transcript retrieval, goal-budget cutover, Ctrl+O, lifecycle truth, server bootstrap, mise completion, fetched-source search, friction closure, context accounting, path display, runtime map generator, and child→parent escalation.

`docs/state/friction/triage-2026-07-20.md` clusters the first local report batch. HR-240 owns append-only dispositions, provider/model/build provenance, fixed-digest proof, and recurrence reopening. Reports are evidence; deletion never means resolved.

Research register retains structured concurrency/Effect, probe debugger/inspeffct/RAD, context DAG/repair, typed tool composition, advisor, Turso evaluation, NCode SCM, Codex PR review, package graduation, reference LSP, fetched-source materialization, transcript inspector, and lifecycle history.

## Review queue / unresolved

1. Arthur reviews only `federated-control-plane.md` §3, §8, §15 if desired; other docs are depth references.
2. HR-237 server bootstrap is blocked until the large server has reachable hostname/Tailscale/SSH registration.
3. HR-205/212 lifecycle commands are designed but not implemented; Arthur must rule on `/relay` versus another linear-successor verb before implementation.
4. HR-233 still needs ordinary `read`/`search` plus authorized `jq`/`fzf` over a decoded virtual/materialized transcript resource and stable durable message IDs.
5. HR-240 report-disposition substrate is designed but not implemented.
6. Correct project-owned GitHub remote is prerequisite to piloting Codex Code Review.

## Naming/final-message addendum

Arthur flagged `/continue` as overloaded and asked for a completion message independent of succession. Arthur selected:

- `/successor` with `/succ` shorthand for the fresh linear successor transaction;
- genealogy retains `continued_from`;
- `/relay` is rejected because it may later name IRC/message routing.

Arthur declined a generic `/finish`: it had no clear job once succession, reversible parking, goal completion, and notes were separated. `/successor --source-note <text>` may carry an optional predecessor note in the handoff. HR-245 is closed as declined.

## Routing and prompt addendum

All project `.omp/*-config.yml` routing uses GPT-5.6 Sol for reasoning/implementation/orchestration roles and GPT-5.6 Luna for scout/research/review/QA/vision roles; only `designer` uses Claude Opus 4.6. A configurable `modelRoles.orchestrator` now points at Sol; future successor code must resolve that role rather than hardcode provider families.
`/successor` itself is stricter than ordinary task routing: explicit `--model` or live `modelRoles.orchestrator` goes through the existing configurable resolver/availability/quota/capability policy; it never hardcodes today's model families or inherits a cheap worker/reviewer lane. It also requires a stable work-descriptive name consistently exposed through IRC, history, fleet, cmux title/notification, and lineage receipts, alongside goal, predecessor, handoff hash, route, location, initiator, and health metadata.

OMP prompts should use native `@<file>` references rather than prose saying “read <file>”; this is recorded in `docs/state/agent-tooling-preferences.md`.

## Memory incident addendum

The full-stream successor `019f8864-b33f-7691-b13f-37c25fa788c6` spawned a scout/implementation wave, Arthur observed roughly 70GB memory, and coordinator PID 40251 ended by SIGKILL. Its IRC/fleet projection still reports `working`, proving stale external liveness. Root cause is unknown; no peak heap/process-tree capture exists. P0 HR-246 owns evidence-first diagnosis; HR-247 cross-session profiler and HR-248 measured resource pooling/admission are requested. Incident: `docs/state/incidents/2026-07-22-omp-subagent-wave-oom.md`. Do not launch another broad local wave or lower permanent caps as a guessed fix.

## Exact next action
Current priority is HR-246/247 instrumentation and controlled diagnosis. `docs/state/harness-priority-board.md` is the organized Now/Next/Blocked/Done view. HR-205 changes/scout evidence remain in the crashed session and children but must not promote until recovered, integrated, and profiled safely; HR-237 remains blocked on server access.
