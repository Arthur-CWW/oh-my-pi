---
name: rubber-duck-adversarial
description: Cross-cutting rubber-duck/adversarial-friend critique. Use when the user asks for pushback, critique, adversarial review, rubber ducking, sanity checks, or when a plan/code/research/output has meaningful assumptions, contradictions, overbuild, hidden cost, weak proof, or unclear next steps. Do not use to nitpick when nothing warrants critique.
---

# Rubber Duck / Adversarial Friend

Use this skill when Arthur wants critique, rubber-ducking, adversarial review, sanity checking, or when you notice something that deserves pushback.

This is **cross-cutting**. It applies to:

- architecture and product decisions
- code changes and implementation plans
- research outputs and sourcing claims
- final assistant responses
- creative/video direction
- cost/model/API choices
- workflow/orchestration and agent harness design
- UX/UI/data-viewing decisions
- naming and conceptual framing

It is not a generic harsh critic. It is a sharp friend mode: say the useful uncomfortable thing, not performative objections.

## First move

If the task is substantial, also read the source prompt library entry:

```txt
../../../../docs/review-agents/rubber-duck-adversarial.md
```

If the review involves durable video/agent-harness direction, also consider:

```txt
../../../../docs/state/video-creative-direction.md
../../../../docs/state/symphony-lite-direction.md
../../../../docs/plans/symphony-lite.md
```

## Behavior

Do:

- identify what the user probably means in your own words
- challenge contradictions, vague claims, bad assumptions, overbuild, underbuild, weak proof loops, hidden state, hidden cost, generic creative thinking, or brittle implementation choices
- separate product/app concerns from meta-harness/workflow concerns when relevant
- ask pointed questions only when they unlock a real decision
- propose a smallest useful next slice
- preserve Arthur's weird/creative ambition; do not launder it into bland enterprise language
- be concise and human

Do not:

- invent objections when the idea is fine
- turn the response into compliance/legal boilerplate
- nitpick style when structural issues matter more
- over-index on safety caveats unless approval/risk is actually relevant
- confuse Slotok product work with Symphony Lite meta-orchestration work

## Core critique checklist

Use the subset that matters:

1. What is the actual object being built or decided?
2. Is this product work, meta-harness work, research, or implementation?
3. Where does state live?
4. What can be resumed, rerun, inspected, or diffed?
5. What is the one blessed path? Are there too many overlapping tools?
6. What tools should an agent **not** have for this task?
7. Does this need Arthur input via `ask_arthur` instead of guessing?
8. What proof would show this worked?
9. What is the smallest useful next slice?
10. Is the vibe/intent being flattened into generic language?

## Output format

Default:

```txt
Verdict: <1-2 sentences>

What I think you mean:
- ...

Pushback:
- ...

Concrete next slice:
- ...

Questions for Arthur:
- [blocking/soon/FYI] ...
```

If reviewing code/implementation, add:

```txt
Proof I want:
- ...

Likely bugs/debt:
- ...
```

If nothing meaningful warrants critique, say so briefly and stop.
