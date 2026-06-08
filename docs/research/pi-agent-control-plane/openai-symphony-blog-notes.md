# OpenAI Symphony blog notes

Source: <https://openai.com/index/open-source-codex-orchestration-symphony/>
Retrieved: 2026-06-05

## Why it matters here

This is the most directly relevant public reference for moving from “multiple agent sessions” to a true **control plane for work**.

## Key takeaways

### 1. The real bottleneck is context switching

OpenAI explicitly says most engineers could only comfortably supervise roughly **3–5 interactive sessions** before productivity dropped.

That is exactly the failure mode Arthur is describing with too many Pi/tmux tabs.

### 2. Work should be the primary object, not sessions

Symphony changes the control plane from:

- agent sessions / tabs / terminals

to:

- issues / tasks / deliverables

Implication for this project:

- the long-term object model should be closer to **workgroups / runs / tasks** than raw tmux window numbers

### 3. Issue tracker as control plane

Symphony’s core move is to let the issue tracker become the control plane, while agents pick up, implement, review, and move work.

Implication for this project:

- even before using Linear/GitHub, we should introduce a local control-plane abstraction
- local **workgroups** can be the first version of this idea

### 4. Agents can create follow-up work themselves

The blog highlights that agents notice adjacent improvements and create new tasks.

Implication for this project:

- the orchestrator session should eventually be able to spawn reviewer/follow-up/planner sessions
- but those actions should go through explicit control-plane tools/state

### 5. First prototype was basically tmux; later moved to app-server

OpenAI says the first Symphony version was effectively a Codex session in tmux polling Linear and spawning workers. They later moved to **Codex App Server / JSON-RPC** because it was more reliable and scalable.

Implication for this project:

- tmux is a good MVP host
- but the product architecture should still separate transport from authority
- if Pi later exposes richer runtime APIs, the control plane can migrate without changing the product model

### 6. Objectives beat rigid state machines

The post says their system evolved from tightly boxed task execution toward richer agent objectives plus tools/context.

Implication for this project:

- the deterministic control plane should hold authoritative state
- the orchestrator agent should handle flexible judgment and natural-language management on top

## Most useful product framing from this post

The article strongly suggests this product framing:

> Stop managing tabs. Start managing work.

For the Pi project, that becomes:

> Stop managing generic tmux windows. Start managing grouped Pi runs through a local control plane.

## Direct implications for Pi control plane

1. Build **workgroups** as first-class objects.
2. Keep an authoritative runtime registry outside the chat/orchestrator session.
3. Use tmux as a host, not as the true model.
4. Treat the popup cockpit as a status surface over a deeper control plane.
5. Add review and stale/blocked detection later, not just launching/switching.
