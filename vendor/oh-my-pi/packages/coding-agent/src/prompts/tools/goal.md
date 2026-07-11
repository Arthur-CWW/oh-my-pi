Manage the active goal-mode objective.

Use a single `op` field:
- `create` starts a goal. Requires `objective`; optional `token_budget` must be positive. Use when no goal exists or the previous goal is complete or dropped.
- `update` replaces any nonterminal goal (active, paused, or budget-limited) with a fresh active goal, objective, and optional budget.
- `get` returns the current goal (active or paused) and remaining token budget.
- `resume` re-activates a paused goal without replacing it.
- `complete` marks the goal complete after you have verified every deliverable against current evidence.
- `drop` discards the current goal without completing it.

Examples:
- `goal({"op":"create","objective":"Implement feature X","token_budget":50000})`
- `goal({"op":"update","objective":"Refined scope for feature X","token_budget":40000})`
- `goal({"op":"get"})`
- `goal({"op":"resume"})`
- `goal({"op":"complete"})`
- `goal({"op":"drop"})`

NEVER call `complete` because a budget is low or a turn is ending. Call it only when the goal is actually done and verified.
If `get` shows a paused goal, use `resume` to continue it unchanged or `update` to replace it.
