# OpenAI harness engineering notes

Source: <https://openai.com/index/harness-engineering/>
Retrieved: 2026-06-05

## Why it matters here

This is the best high-level reference for the shift from “AI helps me code” to “humans design environments and feedback loops while agents execute”. It strongly supports treating the Pi/tmux project as a **control-plane / harness problem**, not as a status-line theming problem.

## Key takeaways

### 1. Human attention is the scarce resource

OpenAI’s framing is essentially:

- humans steer
- agents execute
- the real bottleneck becomes supervision and context switching

That maps directly onto Arthur’s current tmux pain.

### 2. The repo should be the system of record

Important pattern:

- `AGENTS.md` should be a map, not an encyclopedia
- detailed knowledge should live in versioned docs in-repo
- plans, design history, and operating rules should be discoverable by agents

Implication for this project:

- keep the control-plane spec in repo
- keep research notes in repo
- later keep workflow / group / orchestration policy in repo too

### 3. Agent legibility is the design target

The article argues that the codebase and docs should be optimized for what the agent can actually inspect and reason over.

Implication for this project:

- the control-plane state should be explicit and structured
- session/group metadata should be machine-readable
- orchestration behavior should not depend on hidden human memory

### 4. Mechanical guardrails beat prose reminders

OpenAI emphasizes:

- custom linters
- structural constraints
- typed boundaries
- small explicit invariants

Implication for this project:

- the control plane should be deterministic
- naming/grouping/status rules should be explicit
- chat/orchestrator should not be the only authority

### 5. Throughput changes merge/review philosophy

The article says high agent throughput makes old human-gated patterns expensive, and that cheap follow-up corrections sometimes beat blocking everything up front.

Implication for this project:

- we need a good review surface, not just a good launch surface
- the cockpit should help humans decide where intervention is worth it

### 6. Garbage collection / continuous cleanup matters

OpenAI describes recurring cleanup and codified golden principles to keep agent-generated systems coherent.

Implication for this project:

- stale sessions, generic titles, dead groups, and noisy metadata should be treated as cleanup targets
- the control plane should probably own staleness detection and reconciliation later

## Most relevant quotes / ideas paraphrased

- humans no longer spend their leverage writing every line by hand; they spend it designing scaffolding, environments, and feedback loops
- context should be progressively disclosed, not dumped as giant manuals
- repository-local truth is what agents can actually use
- constraints and good structure are what enable speed without decay

## Direct implications for Pi control plane

1. Build a deterministic core before fancy chat behavior.
2. Treat workgroups/runs as first-class objects.
3. Keep workflow/policy/docs in repo.
4. Optimize for reduced supervision cost.
5. Make review and observability part of the product, not an afterthought.
