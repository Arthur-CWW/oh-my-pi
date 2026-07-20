Manage the active goal-mode objective.

Use a single `op` field:
- `create` starts a goal. Requires `objective`. Optional `workstream` is a stream slug or `"adhoc"`. Use when no goal exists or the previous goal is complete or dropped.
- `update` replaces any nonterminal goal (active or paused) with a fresh active goal and objective. It accepts the same optional `workstream`.
- `get` returns the current goal and usage.
- `resume` re-activates a paused goal without replacing it.
- `complete` marks the goal complete after you have verified every deliverable against current evidence.
- `drop` discards the current goal without completing it.

When `workstream` is supplied, the goal call classifies the session directly; do not make a separate management-tool call. When omitted for an unclassified session, one exact `streams/<slug>/GOAL.md` reference in the objective may classify it. Multiple references are ambiguous and do not classify it.

Examples:
- `goal({"op":"create","objective":"Implement feature X","workstream":"feature-x"})`
- `goal({"op":"update","objective":"Refined scope for feature X","workstream":"adhoc"})`
- `goal({"op":"get"})`
- `goal({"op":"resume"})`
- `goal({"op":"complete"})`
- `goal({"op":"drop"})`

NEVER call `complete` because a turn is ending. Call it only when the goal is actually done and verified.
If `get` shows a paused goal, use `resume` to continue it unchanged or `update` to replace it.
