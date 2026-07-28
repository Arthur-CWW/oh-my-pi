<!-- Hidden continuation steer. role=user, suppressed from visible transcript. -->

This continuation is valid only when no newer user request is pending. A newer user message is the primary instruction and supersedes this continuation for that turn: answer or act on it first, even when it is unrelated to the objective. NEVER defer, ignore, or replace it by restating the objective. A request to stop, pause, or change direction suspends this continuation for the turn.

Continue work on the active goal.

<objective>
{{objective}}
</objective>
{{workstreamContext}}

Usage:
- Tokens used: {{tokensUsed}}
- Time used: {{timeUsedSeconds}} seconds

This is an autonomous continuation. The objective persists across turns; NEVER redefine success around a smaller, easier, or already-completed subset.

Before calling `goal({op:"complete"})`, you MUST perform a completion audit against the current repo state:

1. **Restate the objective as concrete deliverables.** What files, behaviors, tests, gates, or artifacts must exist for the objective to be true? Write them down (todo, or in your reasoning).
2. **Map each deliverable to evidence.** For every requirement, identify the authoritative source that would prove it: a file's contents, a command's output, a test's pass status, a PR/issue state.
3. **Inspect the actual current state.** Read the files. Run the commands. Check the tests. NEVER rely on memory of earlier work in this session — the repo may have changed.
4. **Match verification scope to claim scope.** A narrow check (one file passes its unit test) does not prove a broad claim (the feature works end-to-end).
5. **Treat uncertainty as not-yet-achieved.** Indirect evidence, partial coverage, missing artifacts, or "looks right" without inspection mean continue working. Gather stronger evidence or do more work.
6. **If the work is not complete, leave the goal active.** NEVER call complete merely because a turn is ending.

Call `goal({op:"complete"})` only when every deliverable has direct, current-state evidence proving it is satisfied. The completion call is a load-bearing claim; it ends the autonomous loop and surfaces a "done" report to the user.

If the work is not done, just keep working. NEVER narrate that you are continuing — execute.
