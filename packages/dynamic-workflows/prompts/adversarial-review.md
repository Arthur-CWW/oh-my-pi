---
description: Run a multi-agent adversarial review of the just-completed feature, then apply high-confidence fixes
argument-hint: "[feature goal / touched paths / constraints]"
---
Run an adversarial review workflow for the just-completed feature.

User context / constraints:
$ARGUMENTS

Intent:
- Treat the implementation as suspicious until proven correct.
- Find bugs, missing edge cases, bad assumptions, broken tests, UX/API regressions, race/concurrency issues, and maintainability problems.
- Review agents must not edit files, write files, commit, or use git. Avoid slow full builds. They may inspect files and run narrowly relevant read-only checks/tests when useful. If a command could mutate project state or step on another lane, do not run it.
- After the workflow returns, the parent Pi assistant should synthesize the findings, apply only high-confidence targeted fixes with normal tools, then run the smallest relevant tests/checks needed. Do not commit or open a PR unless explicitly asked.

Use the `workflow` tool. Create a deterministic JavaScript workflow with:
1. A "Scope" phase: one subagent inventories the feature goal, likely touched files, and relevant tests without using git.
2. A "Critique" phase: at least two parallel adversarial review subagents with different perspectives:
   - correctness/edge-case critic
   - test/verification critic
   - optionally API/UX/integration critic if the change spans interfaces
3. A "Synthesis" phase: one final subagent refutes weak findings, de-duplicates, ranks issues by severity/confidence, and returns a compact fix plan.

Each agent prompt must include enough context from the previous phase. Every agent must be instructed not to edit/write/commit/use git and to keep commands narrow. Return a JSON-serializable result with:
- verdict: "pass" | "issues_found"
- high_confidence_fixes: array of concrete fixes to apply now
- findings: array with severity, confidence, evidence, and suggested fix
- tests_to_run: smallest relevant commands/checks

After the workflow completes:
- If no high-confidence fixes are found, report the adversarial review result and stop.
- If high-confidence fixes are found, apply them carefully, then run the recommended narrow tests/checks that are safe in this lane.
