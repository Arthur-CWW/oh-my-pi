# Review agent personas

Focused reviewer prompts for Symphony Lite and repo workflows.

These are lenses, not generic second opinions. Prefer constrained tools and concrete artifacts.

## Personas

- [`rubber-duck-adversarial.md`](./rubber-duck-adversarial.md) — sharp friend / adversarial rubber duck for architecture, product, workflow, Slotok, and Symphony Lite decisions.

## Usage pattern

Use with a dynamic workflow subagent or a standalone Pi prompt:

```text
Read @docs/review-agents/rubber-duck-adversarial.md and act as that persona.
Review: <idea/diff/plan>
```

For implementation reviews, pair personas with tool profiles like `reviewer-readonly` so they can inspect but not edit.
