Manage the active goal-mode objective.

Use a single `op` field:
- `create` starts a goal. Requires `objective`; optional `token_budget` must be positive. Use only when no goal exists and no goal is paused.
- `update` replaces the active goal with a new objective and optional budget. Requires an active (or budget-limited) goal; fails if no goal is active.
- `get` returns the current goal (active or paused) and remaining token budget.
- `resume` re-activates a paused goal so work can continue.
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
If `get` shows a paused goal, call `resume` before continuing work on it.
