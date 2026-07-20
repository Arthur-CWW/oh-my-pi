# Temporary subagent routing posture and follow-ups

## Immediate posture

The complete live configuration is tracked at `~/agents/.omp/config.yml`; `~/.omp/agent/config.yml` symlinks to that canonical file. It includes model routing, task policy, extensions, skills, providers, and UI/runtime settings so one Git/jj diff explains the effective personal configuration.

Arthur's temporary subscription-pressure posture (2026-07-20) is recorded as a generator in `docs/state/agent-tooling-preferences.md` and should be revisited after the next weekly reset. The current intent is:

- keep the main/orchestrator model independent from child responsibility lanes;
- use Opus 4.6 High for implementation, planning, synthesis, design, and Oracle-style open-ended work;
- use Luna XHigh for exploration, library lookup, review, and QA/checking;
- disable Operator until its contract is useful and understood;
- prohibit Fable and Haiku subagents; reserve Sol for explicit difficult escalation.

The exact live map is config, not this document.

## Confirmed resolver bug

`resolveSpawnRoute` currently prioritizes `session_explicit` above `agent_model_override`, `agent_frontmatter`, and responsibility roles. Therefore selecting Sol High/XHigh for the main thread with `/model` can silently route children to the same model. This conflates orchestrator selection with child policy.

Temporary guardrail: every `task` spawn passes the responsibility's resolved selector explicitly; `spawn_explicit` has higher precedence than `session_explicit`. `AGENTS.md` records this operational requirement without caching the role map.

Proper fix:

1. Separate `parentSessionModel` from `childModelOverride` in the route ontology.
2. Make parent inheritance opt-in or a final fallback below responsibility policy.
3. Preserve an explicit "spawn like parent" control for deliberate inheritance.
4. Show the winner and every shadowed tier in `:route preview <responsibility>`.
5. Add a matrix test covering main `/model` × responsibility × per-spawn override × workspace/global config.

## Responsibility cleanup

The named responsibilities are behavior/tool templates, not model variants:

- `implementer`: production edits;
- `qa`: verification/proof;
- `reviewer`: independent critique;
- `explore`: read-only codebase scouting;
- `librarian`: source-verified external/library research;
- `plan`: architecture for genuinely complex work;
- `oracle`: difficult open-ended engineering judgment;
- `designer`: UI/UX implementation and review;
- `operator`: operational/environment work;
- `synthesizer`: integration/final synthesis.

The catch-all `task` alias should continue to disappear. Operator is temporarily disabled rather than deleted.

## Other subagent bug to investigate

The Hub/view state can diverge from durable child state: a child becomes orphaned or disappears from the tracked roster, cannot be closed from the view, and transcript/view state no longer reflects the worker lifecycle. Treat durable spawn records/job-manager state as authority; the UI must be a projection with explicit reconciliation, not a second lifecycle owner. Reproduce against the retained legacy binary before carrying any MVU implementation forward.

## Inspection controls

Use `:route preview <responsibility>` before spawning and `:route <agentId>` afterward. Keep `task.showResolvedModelBadge: true` so the actual resolved selector is visible on child rows. A future routing dashboard should expose source tier, selector, effort, account/quota lane, fallbacks, and shadowed candidates without requiring transcript archaeology.
